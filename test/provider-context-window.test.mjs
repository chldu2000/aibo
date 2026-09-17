import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {sessionCapability} from './helpers/session-capability.mjs';
const profile={filesystemPolicy:'read-only',approvalPolicy:'never'};
async function codex(t, env={}) {
  const home=await mkdtemp(path.join(tmpdir(),'aibo-context-catalog-'));
  t.after(()=>rm(home,{recursive:true,force:true}));
  await writeFile(path.join(home,'models_cache.json'),JSON.stringify({fetched_at:new Date().toISOString(),models:[
    {slug:'gpt-fake',context_window:272000,max_context_window:872000},
  ]}));
  return {f:await sessionCapability(t,'codex',{CODEX_HOME:home,...env}),home};
}
test('Codex context choices come from the native catalog and reach a restarted process and recovery',async t=>{
  const {f}=await codex(t);
  const opened=await f.invoke('aibo.session.open',{mode:'create',executionProfile:profile});
  const catalog=await f.invoke('dev.aibo.codex.model.select',{action:'list'});
  assert.deepEqual(catalog.models[0].contextWindows.map(o=>o.tokens),[272000,872000]);
  assert.equal(catalog.currentContextWindow,'272000');
  await assert.rejects(f.invoke('dev.aibo.codex.model.context-window',{action:'set',contextWindow:'1050000'}),/not supported/);
  const selected=await f.invoke('dev.aibo.codex.model.context-window',{action:'set',contextWindow:'872000'});
  assert.equal(selected.currentContextWindow,'872000');
  assert.equal(selected.recovery.data.contextWindow,'872000');
  assert.equal((await f.invoke('aibo.session.turn',{text:'context:872000'},'context')).status,'completed');
  assert.ok(f.events.every(e=>e.event.nativeSessionId===opened.nativeSessionId));
  const restarted=await f.restart();
  await restarted.invoke('aibo.session.open',{mode:'resume',executionProfile:profile,recovery:selected.recovery});
  assert.equal((await restarted.invoke('aibo.session.turn',{text:'context:872000'},'restored')).status,'completed');
  const normal=await restarted.invoke('dev.aibo.codex.model.context-window',{action:'set',contextWindow:'272000'});
  assert.equal(normal.currentContextWindow,'272000');
  assert.equal((await restarted.invoke('aibo.session.turn',{text:'context:272000'},'normal')).status,'completed');
});
test('Codex rejects unsupported sources and stale caches without inventing specifications',async t=>{
  const {f,home}=await codex(t);
  await f.invoke('aibo.session.open',{mode:'create',executionProfile:profile});
  await writeFile(path.join(home,'models_cache.json'),JSON.stringify({fetched_at:'2000-01-01',models:[{slug:'gpt-fake',context_window:272000,max_context_window:872000}]}));
  assert.deepEqual((await f.invoke('dev.aibo.codex.model.select',{action:'list'})).models[0].contextWindows,[]);
  const {f:custom}=await codex(t,{CODEX_FAKE_CUSTOM_PROVIDER:'proxy'});
  await custom.invoke('aibo.session.open',{mode:'create',executionProfile:profile});
  await assert.rejects(custom.invoke('dev.aibo.codex.model.context-window',{action:'set',contextWindow:'872000'}),/not supported/);
});
test('Codex restores previous runtime after native context application fails',async t=>{
  const {f}=await codex(t,{CODEX_FAKE_REJECT_CONTEXT:'1'});
  await f.invoke('aibo.session.open',{mode:'create',executionProfile:profile});
  await assert.rejects(f.invoke('dev.aibo.codex.model.context-window',{action:'set',contextWindow:'872000'}),/Native context rejected/);
  assert.equal((await f.invoke('dev.aibo.codex.model.select',{action:'list'})).currentContextWindow,'272000');
  assert.equal((await f.invoke('aibo.session.turn',{text:'still usable'},'rollback')).status,'completed');
});
test('Pi only exposes documented direct API specifications and changes the running SDK model',async t=>{
  const f=await sessionCapability(t,'pi');
  await f.invoke('aibo.session.open',{mode:'create',executionProfile:{...profile,model:'openai/gpt-5.6-sol'}});
  const catalog=await f.invoke('dev.aibo.pi.model.select',{action:'list'});
  assert.deepEqual(catalog.models.find(m=>m.provider==='openai').contextWindows.map(o=>o.tokens),[272000,1050000]);
  assert.ok(catalog.models.filter(m=>m.provider!=='openai').every(m=>m.contextWindows.length===0));
  const selected=await f.invoke('dev.aibo.pi.model.context-window',{action:'set',contextWindow:'1050000'});
  assert.equal(selected.currentContextWindow,'1050000');
  assert.equal((await f.invoke('aibo.session.turn',{text:'context:1050000'},'context')).status,'completed');
  const restarted=await f.restart();
  await restarted.invoke('aibo.session.open',{mode:'resume',executionProfile:profile,recovery:selected.recovery});
  assert.equal((await restarted.invoke('aibo.session.turn',{text:'context:1050000'},'restored')).status,'completed');
  await restarted.invoke('dev.aibo.pi.model.select',{action:'set',provider:'proxy',modelId:'gpt-5.6-sol'});
  await assert.rejects(restarted.invoke('dev.aibo.pi.model.context-window',{action:'set',contextWindow:'1050000'}),/not supported/);
  assert.equal((await restarted.invoke('dev.aibo.pi.model.select',{action:'list'})).currentContextWindow,null);
});
test('Pi rejected context changes keep SDK and recovery on the previous window',async t=>{
  const f=await sessionCapability(t,'pi',{PI_FAKE_REJECT_CONTEXT:'1'});
  await f.invoke('aibo.session.open',{mode:'create',executionProfile:{...profile,model:'openai/gpt-5.6-sol'}});
  await assert.rejects(f.invoke('dev.aibo.pi.model.context-window',{action:'set',contextWindow:'1050000'}),/Native context rejected/);
  assert.equal((await f.invoke('dev.aibo.pi.model.select',{action:'list'})).currentContextWindow,'272000');
  assert.equal((await f.invoke('aibo.session.turn',{text:'context:272000'},'rollback')).status,'completed');
});

test('Pi real SDK passes the selected model window into its request pipeline',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'aibo-pi-sdk-context-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const f=await sessionCapability(t,'pi',{AIBO_PI_SDK_MODULE:path.resolve('fixtures/pi/context-sdk.mjs'),AIBO_CONTEXT_TEST_DIR:dir,PI_OFFLINE:'1'});
  await f.invoke('aibo.session.open',{mode:'create',executionProfile:{...profile,model:'openai/gpt-5.6-sol'}});
  for(const window of ['1050000','272000']) {
    await f.invoke('dev.aibo.pi.model.context-window',{action:'set',contextWindow:window});
    assert.equal((await f.invoke('aibo.session.turn',{text:'Reply OK'},window)).status,'completed');
  }
  const requests=(await readFile(path.join(dir,'requests.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(requests.map(r=>r.contextWindow),[1050000,272000]);
  assert.ok(requests.every(r=>r.baseUrl==='https://api.openai.com/v1' && r.model==='gpt-5.6-sol'));
  assert.ok(requests[1].messages>requests[0].messages,'window switching retains conversation history');
});
test('Pi auth endpoint overrides cannot inherit official API long-context specifications',async t=>{
  const f=await sessionCapability(t,'pi',{PI_FAKE_AUTH_BASE_URL:'https://proxy.example/v1'});
  await f.invoke('aibo.session.open',{mode:'create',executionProfile:{...profile,model:'openai/gpt-5.6-sol'}});
  assert.equal((await f.invoke('dev.aibo.pi.model.select',{action:'list'})).currentContextWindow,null);
  await assert.rejects(f.invoke('dev.aibo.pi.model.context-window',{action:'set',contextWindow:'1050000'}),/not supported/);
});

test('context mutations cannot bypass an active turn through control',async t=>{
  const {f}=await codex(t);
  await f.invoke('aibo.session.open',{mode:'create',executionProfile:profile});
  const waiting=f.wait('approval.requested');
  const turn=f.startTurn('approval please','busy-context');
  const approval=await waiting;
  await assert.rejects(f.control(turn,'dev.aibo.codex.model.context-window',{action:'set',contextWindow:'872000'}),/busy/);
  await f.control(turn,'dev.aibo.codex.approval.respond',{requestId:approval.payload.requestId,decision:'accept'});
  assert.equal((await turn.done).status,'completed');
});
test('Codex model changes remove the previous model context override',async t=>{
  const {f}=await codex(t);
  await f.invoke('aibo.session.open',{mode:'create',executionProfile:profile});
  await f.invoke('dev.aibo.codex.model.context-window',{action:'set',contextWindow:'872000'});
  const changed=await f.invoke('dev.aibo.codex.model.select',{action:'set',reference:'another-model'});
  assert.equal(changed.current,'another-model');
  assert.equal(changed.currentContextWindow,null);
  assert.equal(changed.recovery.data.contextWindow,null);
  await f.invoke('dev.aibo.codex.model.select',{action:'set',reference:'gpt-fake'});
  assert.equal((await f.invoke('dev.aibo.codex.model.select',{action:'list'})).currentContextWindow,'272000');
});
