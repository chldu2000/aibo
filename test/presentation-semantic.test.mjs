import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { semanticActions,semanticInput,resolveSemanticIntent,semanticPreflightSnapshots } from '../src/lib/presentation-runtime/semantic.ts';
const collection=JSON.parse(await readFile('fixtures/semantic-git/collection.json','utf8'));
test('semantic package input preserves the complete validated snapshot and host-owned action identities',()=>{
  const input=semanticInput(collection,19);
  assert.deepEqual(input.data.snapshot,collection);
  assert.notEqual(input.data.snapshot,collection);
  const actions=semanticActions(collection);
  const item=actions.find(entry=>entry.action.itemId!==null);
  assert.ok(item);
  assert.deepEqual(resolveSemanticIntent(collection,item.token),item.action);
  assert.deepEqual(item.action.context,collection.context);
  const disabled=structuredClone(collection);disabled.actions=disabled.actions.map(action=>({...action,enabled:false}));
  assert.throws(()=>resolveSemanticIntent(disabled,item.token),/unsupported_semantic_intent/);
  assert.throws(()=>resolveSemanticIntent(collection,'arbitrary:execute'),/unsupported_semantic_intent/);
});
test('preflight supplies valid snapshots for every mandatory semantic kind',()=>{
  assert.deepEqual(semanticPreflightSnapshots().map(snapshot=>semanticInput(snapshot,1).data.snapshot.view.kind),['collection','detail','settings','inspector']);
});
test('write intents retain host context and never accept replacement execution input',()=>{
  const snapshot=semanticPreflightSnapshots()[1];
  snapshot.schema='aibo.semantic-view/v1.1';
  snapshot.actions=[{id:'dev.aibo.preflight.apply',label:'Apply',intent:'execute',enabled:true,input:{request:'host-owned'}}];
  const projected=semanticInput(snapshot,2);
  projected.data.snapshot.actions[0].input.request='changed by presentation';
  const action=resolveSemanticIntent(snapshot,projected.data.actions[0].token);
  assert.equal(snapshot.actions[0].input.request,'host-owned');
  assert.deepEqual(action,{context:snapshot.context,actionId:'dev.aibo.preflight.apply',itemId:null});
});
