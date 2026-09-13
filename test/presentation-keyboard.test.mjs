import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {renderConversation} from '../packages/presentation-workbench/conversation.js';
import {createConversationDirectory} from '../src/lib/presentation-runtime/conversation.ts';
const flatten=tree=>[tree,...(tree.children??[]).flatMap(flatten)];
test('composer shortcut uses current host send or queue authority and disappears when unavailable',async()=>{
 const state=JSON.parse(await readFile('fixtures/presentation-workbench/conversation.json','utf8'));
 state.session.capabilities.push('queue.manage');
 const directory=createConversationDirectory();
 for(const variant of [{...state,running:false},{...state,running:true},{...state,busy:true},{...state,draft:''}]){
  const actions=directory.project(variant),nodes=flatten(renderConversation(variant,actions));
  const editor=nodes.find(node=>node.key==='conversation:draft:input');
  const action=actions.find(action=>action.operation===(variant.running?'queueSteer':'send'));
  assert.equal(editor.primaryEnter,action?.token);
  if(action)assert.equal(action.event,'click');
 }
});
