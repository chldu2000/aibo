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
 assert.equal(paths.confirmWithTab,false);assert.ok(paths.keys.every(key=>key.startsWith('path:')));
});

test('command categories retain per-category limits and empty menus remain valid',async()=>{
 const state=JSON.parse(await readFile('fixtures/presentation-workbench/conversation.json','utf8'));
 state.draft='/';state.agentCommands=[...Array.from({length:30},(_,i)=>({name:'agent'+i,source:'agent'})),{name:'skill-command',source:'skill'},{name:'extension-command',source:'prompt'}];
 const directory=createConversationDirectory();
 let nodes=flatten(renderConversation(state,directory.project(state)));
 const config=nodes.find(node=>node.key==='conversation:draft:input').suggestions;
 assert.equal(config.categories[0].options.length,24);
 assert.deepEqual(config.categories[2].options,['command:skill-command']);
 assert.deepEqual(config.categories[3].options,['command:extension-command']);
 assert.ok(config.keys.includes('command:skill-command'),'categories do not lose entries beyond the all-category limit');
 const list=nodes.find(node=>node.key==='conversation:command-options');
 assert.equal(list.attrs.role,'listbox');
 assert.ok(list.children.every(node=>node.attrs.role==='option'));
 assert.ok(!flatten(list).some(node=>node.key.startsWith('commands:category:')));
 assert.equal(nodes.find(node=>node.key==='commands:category:all').attrs['aria-pressed'],'true');
 state.agentCommands=[];nodes=flatten(renderConversation(state,directory.project(state)));
 assert.ok(nodes.some(node=>node.key==='conversation:commands'));
 assert.equal(nodes.find(node=>node.key==='conversation:draft:input').suggestions.keys.length,0);
});

test('mention suggestions expose All, Files, Folders and Sessions categories',async()=>{
 const state=JSON.parse(await readFile('fixtures/presentation-workbench/conversation.json','utf8'));
 state.draft='@';
 state.workspacePathSuggestions=[{path:'src',isDirectory:true},{path:'README.md',isDirectory:false}];
 state.sessionSuggestions=[{...state.session,id:'other',label:'Other session',agent:'codex'}];
 const directory=createConversationDirectory();
 const value={...state};
 const nodes=flatten(renderConversation(value,directory.project(value)));
 const config=nodes.find(node=>node.key==='conversation:draft:input').suggestions;
 assert.deepEqual(config.categories.map(category=>category.key),[
  'mentions:category:all','mentions:category:files','mentions:category:folders','mentions:category:sessions',
 ]);
 assert.deepEqual(config.categories[1].options,['path:README.md']);
 assert.deepEqual(config.categories[2].options,['path:src']);
 assert.deepEqual(config.categories[3].options,['session-reference:other']);
});
