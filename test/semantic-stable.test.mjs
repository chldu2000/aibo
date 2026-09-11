import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {assertSnapshot} from '../src/lib/presentation/validation.ts';
import {actionMessage} from '../src/lib/presentation/actions.ts';
import {createInstalledController} from '../src/lib/presentation/installed-controller.ts';
const source=JSON.parse(await readFile('fixtures/semantic-git/detail.json','utf8'));
const settings={...source,schema:'aibo.semantic-view/v1',context:{...source.context,workspaceId:null},contribution:{...source.contribution,extensionPoint:'settings.page'},view:{...source.view,kind:'settings'},actions:[{id:'refresh',label:'刷新',intent:'refresh',enabled:true}]};
test('stable settings and session inspector keep scope and bounded JSON semantics',()=>{
  assertSnapshot(settings);
  const inspector={...settings,context:{...source.context,sessionId:'session'},contribution:{...source.contribution,extensionPoint:'session.context'},view:{...source.view,kind:'inspector'}};
  assertSnapshot(inspector);
  for(const mutate of [s=>s.context.workspaceId='forged',s=>s.view.fields=[{type:'html'}],s=>s.view.content='x'.repeat(210001),s=>s.view.content='界'.repeat(90000),s=>s.schema='aibo.semantic-view/v2']){
    const value=structuredClone(settings);mutate(value);assert.throws(()=>assertSnapshot(value));
  }
  const missing=structuredClone(inspector);delete missing.context.sessionId;assert.throws(()=>assertSnapshot(missing));
  assertSnapshot(source); // Published experimental snapshots retain their original reader.
});
test('application semantic controller verifies null workspace and scopes subsequent actions',async()=>{
  let published;const released=[];
  const controller=createInstalledController({cancelOpen:async()=>{},open:async(...args)=>{assert.deepEqual(args[4],{kind:'application'});return settings;},release:async id=>released.push(id),act:async()=>({...settings,context:{...settings.context,sessionId:'forged',revision:2}})},value=>published=value);
  await controller.open('',{installationId:'release',contributionId:settings.context.contributionId,title:'Settings',available:true,issue:null},{kind:'application'});
  assert.equal(published,settings);
  await controller.act(actionMessage(settings,'refresh'));
  assert.equal(published,null);assert.deepEqual(released,[settings.context.generation]);controller.dispose();
});
test('generic inspect action validates the selected item',async()=>{
  const collection=JSON.parse(await readFile('fixtures/semantic-git/collection.json','utf8'));
  collection.schema='aibo.semantic-view/v1';collection.actions=collection.actions.map(action=>action.id==='open-diff'?{...action,id:'inspect'}:action);
  assertSnapshot(collection);
  assert.equal(actionMessage(collection,'inspect',collection.view.items[0].id).actionId,'inspect');
  assert.throws(()=>actionMessage(collection,'inspect','missing'));
  assert.throws(()=>actionMessage(collection,'refresh',collection.view.items[0].id));
});
