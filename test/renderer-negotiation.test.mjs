import { translateMessage } from '../packages/i18n/index.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateRenderer,choosePresentation} from '../src/lib/app/renderer-negotiation.ts';
const snapshot=JSON.parse(await readFile('fixtures/semantic-git/collection.json','utf8'));
const descriptor={id:'dev.test.renderer',version:'1.0.0',semanticVersion:'1.0.0',core:['collection','detail','settings','inspector'],optional:[{id:'dev.test.renderer.graph',version:'1.0.0',semantic:'collection'}]};
test('renderer preflight refuses missing required core semantics and malformed optional contracts',()=>{
  validateRenderer(descriptor);
  for(const core of [[],['collection','detail'],['collection','detail','settings','settings'],[...descriptor.core,'unknown']])assert.throws(()=>validateRenderer({...descriptor,core}));
  for(const optional of [[...descriptor.optional,...descriptor.optional],[{...descriptor.optional[0],id:'other.plugin.graph'}],[{...descriptor.optional[0],semantic:'unknown'}]])assert.throws(()=>validateRenderer({...descriptor,optional}));
  assert.throws(()=>validateRenderer({...descriptor,semanticVersion:'2.0.0'}));
});
test('specialization and core fallback retain exactly the same facts and operations',()=>{
  const specialized=choosePresentation(descriptor,snapshot,{id:'dev.test.renderer.graph',version:'1.0.0'});
  assert.equal(specialized.kind,'specialized');
  for(const preference of [{id:'dev.test.renderer.graph',version:'2.0.0'},{id:'missing.renderer.graph',version:'1.0.0'}]){
    const fallback=choosePresentation(descriptor,snapshot,preference);
    assert.equal(fallback.kind,'core');assert.equal(fallback.reason,'specialized_presentation_unavailable');
    assert.deepEqual(fallback.snapshot,specialized.snapshot);
    fallback.snapshot.actions.length=0;assert.ok(snapshot.actions.length>0,'selection cannot mutate host facts');
  }
  assert.throws(()=>choosePresentation(descriptor,{...snapshot,view:{kind:'arbitrary-html'}}));
});
test('optional specialization cannot receive the wrong semantic kind',async()=>{
  const detail=JSON.parse(await readFile('fixtures/semantic-git/detail.json','utf8'));
  const choice=choosePresentation(descriptor,detail,{id:'dev.test.renderer.graph',version:'1.0.0'});
  assert.equal(choice.kind,'core');assert.deepEqual(choice.snapshot,detail);
});

test('snapshot 1.1 requires explicit renderer support independently of core semantic version',()=>{
 const writeView={...structuredClone(snapshot),schema:'aibo.semantic-view/v1.1',actions:[...snapshot.actions,{id:'dev.test.write',label:'Write',intent:'execute',enabled:true,input:{value:'frozen'}}]};
 assert.throws(()=>choosePresentation(descriptor,writeView),/snapshot version not supported/);
 const supported={...descriptor,snapshotSchemas:['aibo.semantic-view/v1','aibo.semantic-view/v1.1']};
 assert.deepEqual(choosePresentation(supported,writeView).snapshot,writeView);
 for(const snapshotSchemas of [[],['aibo.semantic-view/v1.1'],['aibo.semantic-view/v1','aibo.semantic-view/v1'],['aibo.semantic-view/v1','aibo.semantic-view/v9']])assert.throws(()=>validateRenderer({...descriptor,snapshotSchemas}),/snapshot schema declaration/);
 assert.deepEqual(choosePresentation(descriptor,snapshot).snapshot,snapshot);
});


test('renderer guard diagnostics localize without mutating declarations or host snapshots',()=>{
 const cases=[
  [{...descriptor,id:'bad id'},'presentation.rendererIdentity','incompatible_renderer: identity or version'],
  [{...descriptor,core:[]},'presentation.rendererCore','incompatible_renderer: missing core semantics'],
  [{...descriptor,optional:Array(33).fill(descriptor.optional[0])},'presentation.rendererLimit','incompatible_renderer: optional limit'],
  [{...descriptor,snapshotSchemas:[]},'presentation.rendererSchemas','incompatible_renderer: snapshot schema declaration'],
  [{...descriptor,optional:[{...descriptor.optional[0],id:'foreign.graph'}]},'presentation.rendererOptional','incompatible_renderer: optional declaration'],
 ];
 for(const [value,key,diagnostic] of cases){
  const original=structuredClone(value);
  assert.throws(()=>validateRenderer(value),error=>{
   assert.equal(error.message,diagnostic);assert.equal(error.localized.key,key);
   for(const locale of ['zh-CN','en'])assert.notEqual(translateMessage(locale,error.localized),diagnostic);
   return true;
  });
  assert.deepEqual(value,original);
 }
 const newer={...structuredClone(snapshot),schema:'aibo.semantic-view/v1.1'};const original=structuredClone(newer);
 assert.throws(()=>choosePresentation(descriptor,newer),error=>{assert.equal(error.message,'incompatible_renderer: snapshot version not supported');assert.equal(error.localized.key,'presentation.snapshotVersion');return true;});
 assert.deepEqual(newer,original);
 assert.deepEqual(choosePresentation(descriptor,snapshot).snapshot,snapshot);
});
