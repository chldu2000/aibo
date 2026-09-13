import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {renderConversation} from '../packages/presentation-workbench/conversation.js';
import {createConversationDirectory} from '../src/lib/presentation-runtime/conversation.ts';
const flatten=tree=>[tree,...(tree.children??[]).flatMap(flatten)];
test('suggestions filter commands and bind only available host buttons while plain text remains multiline',async()=>{
 const state=JSON.parse(await readFile('fixtures/presentation-workbench/conversation.json','utf8'));
 state.agentCommands=[{name:'help',aliases:['assist'],description:'Support'},{name:'hello',description:'Greeting'},{name:'disabled',description:'assist',enabled:false}];
 const directory=createConversationDirectory();
 const render=draft=>{const value={...state,draft};return flatten(renderConversation(value,directory.project(value)));};
 const editor=nodes=>nodes.find(node=>node.key==='conversation:draft:input');
 assert.deepEqual(editor(render('/assist')).suggestions.keys,['command:help']);
 assert.equal(editor(render('/he')).suggestions.confirmWithTab,false);
 assert.deepEqual(editor(render('/he')).suggestions.keys,['command:help','command:hello']);
 assert.equal(editor(render('ordinary text')).suggestions,undefined);
 const paths=editor(render('@src')).suggestions;
 assert.equal(paths.confirmWithTab,true);assert.ok(paths.keys.every(key=>key.startsWith('path:')));
});
