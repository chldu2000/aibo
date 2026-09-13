import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {renderCapability} from '../packages/presentation-workbench/capability.js';
import {createCapabilityWorkbenchDirectory} from '../src/lib/presentation-runtime/capability-workbench.ts';
const flatten=tree=>[tree,...(tree.children??[]).flatMap(flatten)];
test('unsupported specialized reading falls back visibly without reducing the core snapshot or action identity',async()=>{
 const state=JSON.parse(await readFile('fixtures/presentation-workbench/capability.json','utf8'));
 state.view.snapshot=JSON.parse(await readFile('fixtures/semantic-git/partial-detail.json','utf8'));
 const original=structuredClone(state.view.snapshot);
 const directory=createCapabilityWorkbenchDirectory();
 for(const enhanced of [true,false]){
  state.view.enhanced=enhanced;
  const actions=directory.project(state);let rendered;
  const nodes=flatten(renderCapability(state,actions,input=>{rendered=input;return {tag:'div',key:'semantic'};}));
  assert.deepEqual(rendered.snapshot,original,'properties, content, truncation and context stay intact');
  const semantic=actions.filter(action=>action.operation==='semantic');
  assert.deepEqual(rendered.actions.map(action=>({token:action.token,action:action.action})),semantic.map(action=>({token:action.token,action:JSON.parse(action.args[0])})));
  assert.equal(nodes.some(node=>node.key==='capability:reading-fallback'),enhanced);
  assert.equal(nodes.find(node=>node.key==='capability:toggleReading').text,enhanced?'使用通用阅读':'尝试专业阅读');
 }
});
