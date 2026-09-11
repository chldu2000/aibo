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
