import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkspacePreferencesController } from '../src/lib/app/workspace-preferences-controller.ts';

const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};

test('workspace defaults publish only native-confirmed saves and serialize toggles', async()=>{
  let state;const pending=deferred();const calls=[];
  const controller=createWorkspacePreferencesController({read:async()=>({trustNewWorkspaces:true}),save:value=>{calls.push(value);return pending.promise},changed:value=>{state=value}});
  await controller.load();const save=controller.save(false);
  assert.equal(state.saving,true);assert.equal(state.value.trustNewWorkspaces,true);
  await controller.save(true);assert.deepEqual(calls,[false]);
  pending.resolve({trustNewWorkspaces:false});await save;
  assert.equal(state.saving,false);assert.equal(state.value.trustNewWorkspaces,false);
});

test('failed save preserves last confirmed preference and can be retried',async()=>{
  let state,fail=true;
  const controller=createWorkspacePreferencesController({read:async()=>({trustNewWorkspaces:false}),save:async value=>{if(fail)throw Error('disk full');return {trustNewWorkspaces:value}},changed:value=>{state=value}});
  await controller.load();await controller.save(true);
  assert.equal(state.value.trustNewWorkspaces,false);assert.equal(state.error,'disk full');assert.equal(state.saving,false);
  fail=false;await controller.save(true);assert.equal(state.value.trustNewWorkspaces,true);assert.equal(state.error,null);
});

test('reopened settings use the latest native preference and ignore late reads',async()=>{
  let state;const reads=[deferred(),deferred()];let call=0;
  const controller=createWorkspacePreferencesController({read:()=>reads[call++].promise,save:async()=>assert.fail('unexpected save'),changed:value=>{state=value}});
  const first=controller.load();const second=controller.load();
  reads[1].resolve({trustNewWorkspaces:false});await second;
  reads[0].resolve({trustNewWorkspaces:true});await first;
  assert.equal(state.value.trustNewWorkspaces,false);assert.equal(state.loading,false);
});

test('failed or malformed reads cannot silently enable a setting or accept writes',async()=>{
  for(const response of [[],null,{trustNewWorkspaces:'false'},Error('read failed')]){
    let state;let calls=0;
    const controller=createWorkspacePreferencesController({read:async()=>{if(response instanceof Error)throw response;return response},save:async()=>{calls++;return {trustNewWorkspaces:true}},changed:value=>{state=value}});
    await controller.load();await controller.save(true);
    assert.equal(state.value,null);assert.equal(calls,0);assert(state.error);assert.equal(state.loading,false);
  }
});
