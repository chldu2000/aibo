import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import Ajv from 'ajv';
import { createAgentSettingsController } from '../src/lib/app/agent-settings-controller.ts';
import { sessionCapability } from './helpers/session-capability.mjs';
const target = (id = 'a') => ({installationId:id,contributionId:`dev.${id}.agent`,scope:{kind:'application'}});
const descriptor = {schema:'aibo.agent-settings/v1',version:1,title:'Settings',scopes:['application'],fields:[{key:'text',label:'Text',type:'text',default:''}]};
const snapshot = (target,values={},revision=0) => ({target,descriptor,revision,values,effectiveValues:{text:'',...values},inheritedValues:{text:''}});
const deferred = () => { let resolve,reject; const promise = new Promise((a,b) => {resolve=a;reject=b;}); return {promise,resolve,reject}; };

test('settings manifest descriptor and standalone contract stay identical', async () => {
  const manifest = JSON.parse(await readFile('contracts/plugin-manifest.v2.schema.json','utf8'));
  const standalone = JSON.parse(await readFile('contracts/agent-settings.v1.schema.json','utf8'));
  const {$schema,$id,...schema} = standalone;
  assert.deepEqual(manifest.$defs.agentSettings,schema);
  const validate = new Ajv({strict:false}).compile(standalone);
  for (const name of ['pi','codex']) {
    const plugin = JSON.parse(await readFile(`src-tauri/capability-plugins/${name}/plugin.json`,'utf8'));
    assert.equal(validate(plugin.contributions[0].settings),true,JSON.stringify(validate.errors));
  }
  for (const patch of [{fields:[]},{schema:'unknown'},{version:0},{scopes:['unknown']},{javascript:'alert(1)'}]) assert.equal(validate({...descriptor,...patch}),false);
});

test('settings controller isolates async loads and retains per-Agent drafts', async () => {
  const a=deferred(),b=deferred(); let state;
  const c=createAgentSettingsController({read:t=>t.installationId==='a'?a.promise:b.promise,save:async()=>{throw Error('not used');},changed:s=>state=s});
  const loadA=c.select(target('a')),loadB=c.select(target('b'));
  b.resolve(snapshot(target('b'))); await loadB;
  c.change('text','B draft');
  a.resolve(snapshot(target('a')));await loadA;
  assert.equal(state.target.installationId,'b');assert.equal(state.draft.text,'B draft');
  await c.select(target('a'));c.change('text','A draft');
  await c.select(target('b'));assert.equal(state.draft.text,'B draft');
});

test('settings saves capture identity and revision; conflicts keep drafts until explicit reload', async () => {
  let state,request;const pending=deferred();
  const c=createAgentSettingsController({read:async t=>snapshot(t,{text:'saved'},4),save:async r=>{request=r;return pending.promise;},changed:s=>state=s});
  await c.select(target());c.change('text','mine');
  const save=c.save();await c.select(target('b'));
  pending.reject(Error('settings_conflict'));await save;
  assert.equal(state.target.installationId,'b');assert.equal(state.error,null);
  assert.deepEqual(request,{...target(),version:1,expectedRevision:4,values:{text:'mine'}});
  await c.select(target());assert.equal(state.draft.text,'mine');assert.match(state.error,/settings_conflict/);
  await c.reload();assert.equal(state.draft.text,'saved');assert.equal(state.error,null);
  c.change('text','');assert.equal(state.draft.text,'');c.change('text',undefined);assert.deepEqual(state.draft,{});
});

for (const name of ['codex','pi']) test(`${name} uses settings on the next turn and supports reset without restarting`,async t=>{
  const f=await sessionCapability(t,name);
  await f.invoke('aibo.session.open',{mode:'create',executionProfile:{interactionMode:'ask',filesystemPolicy:'read-only',commandPolicy:'disabled',networkPolicy:'disabled',approvalPolicy:'on-request',approvalReviewer:'user'}});
  const request=f.request('aibo.session.turn',{text:'settings prompt'},'configured');
  request.context.settings={schema:'aibo.agent-settings/v1',version:1,values:{additionalInstructions:'Be concise.'}};
  await f.rpc('capability.invoke',request);
  const configured=f.events.filter(e=>e.event.turnId==='configured'&&e.event.type==='message.delta').map(e=>e.event.payload.delta).join('');
  assert.equal(configured,'Be concise.\n\nsettings prompt');
  await f.invoke('aibo.session.turn',{text:'plain prompt'},'reset');
  const plain=f.events.filter(e=>e.event.turnId==='reset'&&e.event.type==='message.delta').map(e=>e.event.payload.delta).join('');
  assert.equal(plain,'plain prompt');
});

test('revisiting a dirty scope refreshes inheritance without replacing its draft or conflict revision', async () => {
  let state, inherited='old',revision=1;
  const c=createAgentSettingsController({read:async t=>({...snapshot(t,{text:'stored'},revision),inheritedValues:{text:inherited}}),save:async()=>{throw Error('not used');},changed:s=>state=s});
  await c.select(target());c.change('text','draft');
  await c.select(null);inherited='new';revision=2;
  await c.select(target());
  assert.equal(state.snapshot.inheritedValues.text,'new');
  assert.equal(state.snapshot.revision,1);
  assert.equal(state.draft.text,'draft');
});
