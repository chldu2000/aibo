import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import Ajv from 'ajv/dist/2020.js';
import { managementPanels, managementSettingsTargets, createManagementSettingsStore, settingsTargetKey } from '../src/lib/app/management-panels.ts';
const read = async path => JSON.parse(await readFile(path, 'utf8'));
const fixture = await read('fixtures/plugins/management-panel/manifest.json');
const panel = fixture.contributions.at(-1);
const target = contributionId => ({installationId:'example', contributionId, scope:{kind:'application'}});
const snapshot = target => ({target,descriptor:{schema:'aibo.agent-settings/v1',version:1,title:target.contributionId,scopes:['application'],fields:[{key:'text',label:'Text',type:'text',default:''}]},revision:0,values:{},effectiveValues:{text:''},inheritedValues:{text:''}});

test('management declarations are bounded, reject premature dynamic providers, and share the manifest schema', async () => {
  const schema = await read('contracts/plugin-manifest.v2.schema.json');
  const {$schema,$id,...standalone} = await read('contracts/management-panel.v1.schema.json');
  assert.deepEqual(schema.$defs.managementPanel,standalone);
  const ajv = new Ajv({strict:false});ajv.addFormat('uri',()=>true);
  const valid = ajv.compile(schema);
  assert.equal(valid(fixture),true,JSON.stringify(valid.errors));
  for (const mutate of [p=>p.sections[0].providers={},p=>p.sections[0].settingsReferences=[],p=>p.sections[0].scopes=['arbitrary'],p=>p.sections=Array(17).fill(p.sections[0]),p=>p.required=true]) {
    const changed=structuredClone(fixture);mutate(changed.contributions.at(-1));assert.equal(valid(changed),false);
  }
});

test('discovery includes disabled installations without depending on Agent identity', () => {
  const entries=managementPanels([{id:'example',installed:true,enabled:false,contributions:fixture.contributions.map(metadata=>({kind:metadata.kind,metadata}))}]);
  assert.equal(entries.length,1);assert.equal(entries[0].declaration.title,'Example Agent');assert.equal(entries[0].enabled,false);
  assert.equal(managementPanels([{id:'example',installed:false,enabled:true,contributions:[{kind:panel.kind,metadata:panel}]}]).length,0);
});

test('two forms save independently, share controllers across entries, and preserve a conflicting draft', async () => {
  let states;const saves=[];
  const a=target(panel.relatedContributions[0]),b=target(panel.relatedContributions[1]);
  const store=createManagementSettingsStore({read:async t=>snapshot(t),save:async request=>{
    if(request.contributionId===a.contributionId)throw Error('settings_conflict: changed');
    saves.push(request);return {...snapshot(request),values:request.values,revision:1};
  },changed:next=>states=next});
  const ca=store.controller(a),cb=store.controller(b);
  await Promise.all([ca.select(a),cb.select(b)]);
  ca.change('text','draft A');cb.change('text','draft B');await Promise.all([ca.save(),cb.save()]);
  assert.equal(states[settingsTargetKey(a)].draft.text,'draft A');assert.match(states[settingsTargetKey(a)].error,/changed/);
  assert.equal(states[settingsTargetKey(b)].snapshot.values.text,'draft B');assert.equal(saves.length,1);
  assert.equal(store.controller(structuredClone(a)),ca);
  store.retain([]);assert.deepEqual(states,{});
});

test('removed installations cannot be revived by a late settings read', async () => {
  let resolve,states;const pending=new Promise(r=>resolve=r);const a=target('first');
  const store=createManagementSettingsStore({read:()=>pending,save:async()=>{throw Error('unused');},changed:s=>states=s});
  const loading=store.controller(a).select(a);store.retain([]);resolve(snapshot(a));await loading;
  assert.deepEqual(states,{});
});

test('session scope uses the pinned provider, requires live context, and deduplicates repeated targets', () => {
  const entry={id:'plugin:example',installationId:'example',enabled:true,declaration:structuredClone(panel)};
  const session={id:'session',agent:panel.relatedContributions[1],pluginInstallationId:'example',archived:false};
  assert.equal(managementSettingsTargets(entry,'behavior','workspace',null,null).length,0);
  assert.equal(managementSettingsTargets(entry,'behavior','session',null,{...session,archived:true}).length,0);
  assert.equal(managementSettingsTargets(entry,'behavior','session',null,{...session,pluginInstallationId:'other-release'}).length,0);
  const selected=managementSettingsTargets(entry,'behavior','session',null,session);
  assert.equal(selected.length,1);assert.equal(selected[0].contributionId,session.agent);
  entry.declaration.sections[0].settingsReferences.push({...entry.declaration.sections[0].settingsReferences[0],key:'alias'});
  assert.equal(managementSettingsTargets(entry,'behavior','application',null,null).length,2);
});

test('old controller responses cannot overwrite a new controller for the same installation target', async () => {
  let resolve,states;const a=target('first');let first=true;
  const store=createManagementSettingsStore({read:async t=>first?(first=false,await new Promise(r=>resolve=r)):snapshot(t),save:async()=>{throw Error('unused');},changed:s=>states=s});
  const oldRead=store.controller(a).select(a);store.retain([]);
  const current=store.controller(a);await current.select(a);current.change('text','new draft');
  resolve({...snapshot(a),values:{text:'old result'}});await oldRead;
  assert.equal(states[settingsTargetKey(a)].draft.text,'new draft');
});
