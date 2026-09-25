import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionReferencePreferencesController } from '../src/lib/app/session-reference-preferences-controller.ts';

const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};

test('reference preferences publish only native-confirmed saves and serialize toggles', async()=>{
  let state;const pending=deferred();const calls=[];
  const controller=createSessionReferencePreferencesController({read:async()=>({messageLimit:12}),save:value=>{calls.push(value);return pending.promise},changed:value=>{state=value}});
  await controller.load();const save=controller.save(null);
  assert.equal(state.saving,true);assert.equal(state.value.messageLimit,12);
  await controller.save(12);assert.deepEqual(calls,[null]);
  pending.resolve({messageLimit:null});await save;
  assert.equal(state.saving,false);assert.equal(state.value.messageLimit,null);
});

test('failed save preserves last confirmed preference and can be retried',async()=>{
  let state,fail=true;
  const controller=createSessionReferencePreferencesController({read:async()=>({messageLimit:null}),save:async value=>{if(fail)throw Error('disk full');return {messageLimit:value}},changed:value=>{state=value}});
  await controller.load();await controller.save(12);
  assert.equal(state.value.messageLimit,null);assert.equal(state.error,'disk full');assert.equal(state.saving,false);
  fail=false;await controller.save(12);assert.equal(state.value.messageLimit,12);assert.equal(state.error,null);
});

test('reopened settings use the latest native preference and ignore late reads',async()=>{
  let state;const reads=[deferred(),deferred()];let call=0;
  const controller=createSessionReferencePreferencesController({read:()=>reads[call++].promise,save:async()=>assert.fail('unexpected save'),changed:value=>{state=value}});
  const first=controller.load();const second=controller.load();
  reads[1].resolve({messageLimit:null});await second;
  reads[0].resolve({messageLimit:12});await first;
  assert.equal(state.value.messageLimit,null);assert.equal(state.loading,false);
});

test('failed or malformed reads cannot silently enable a setting or accept writes',async()=>{
  for(const response of [[],null,{}, {messageLimit:'12'}, {messageLimit:0}, {messageLimit:1.5}, {messageLimit:10001},Error('read failed')]){
    let state;let calls=0;
    const controller=createSessionReferencePreferencesController({read:async()=>{if(response instanceof Error)throw response;return response},save:async()=>{calls++;return {messageLimit:12}},changed:value=>{state=value}});
    await controller.load();await controller.save(12);
    assert.equal(state.value,null);assert.equal(calls,0);assert(state.error);assert.equal(state.loading,false);
  }
});

test('invalid recent counts never reach persistence', async()=>{
  let state;const calls=[];
  const controller=createSessionReferencePreferencesController({read:async()=>({messageLimit:12}),save:async value=>{calls.push(value);return {messageLimit:value}},changed:value=>{state=value}});
  await controller.load();
  for (const value of [0,-1,1.5,10001,NaN]) { await controller.save(value); assert(state.error); assert.equal(state.value.messageLimit,12); }
  assert.deepEqual(calls,[]);
  await controller.save(1);assert.equal(state.value.messageLimit,1);
  await controller.save(10000);assert.equal(state.value.messageLimit,10000);
});
