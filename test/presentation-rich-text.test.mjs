import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseMarkdown,inlineSegments,displayMarkdown} from '../packages/presentation-workbench/markdown.js';
import {renderRichText} from '../packages/presentation-workbench/rich-text.js';
import {createConversationDirectory} from '../src/lib/presentation-runtime/conversation.ts';
const content='# Heading\n\nA **bold** word and `inline` [safe](https://example.invalid) [unsafe](javascript:alert).\n\n- First\n- Second\n\n```js\nconst x = "<script>";\n```\n[AIBO_CONTEXT_ATTACHMENTS]private transport[/AIBO_CONTEXT_ATTACHMENTS]';
const flatten=tree=>[tree,...(tree.children??[]).flatMap(flatten)];
test('shared markdown preserves the existing subset and hides only transport metadata',()=>{
 const blocks=parseMarkdown(displayMarkdown(content));assert.deepEqual(blocks.map(block=>block.kind),['heading','paragraph','list','code']);
 assert.equal(blocks.at(-1).lines[0],'const x = "<script>";');
 assert.equal(inlineSegments('[unsafe](javascript:alert)')[0].kind,'text');
 assert.equal(inlineSegments('[mail](mailto:user@example.invalid)')[0].kind,'link');
});
test('rich text links and code copies bind current message content and revoke stale content',async()=>{
 const state=JSON.parse(await readFile('fixtures/presentation-workbench/conversation.json','utf8'));state.timeline[0].content=content;
 const directory=createConversationDirectory(),actions=directory.project(state),context={workspaceId:'w',sessionId:'s',revision:1};
 const tree=renderRichText(content,'message:m','m',actions),nodes=flatten(tree);
 assert.ok(nodes.some(node=>node.tag==='strong'&&flatten(node).some(child=>child.text==='bold')));
 assert.ok(nodes.some(node=>node.tag==='code'&&flatten(node).map(child=>child.text??'').join('')==='const x = "<script>";'));
 assert.ok(!JSON.stringify(tree).includes('private transport'));
 assert.ok(!nodes.some(node=>node.tag==='script'||node.attrs?.href));
 const copy=actions.find(action=>action.operation==='copyCode'),link=actions.find(action=>action.operation==='openLink');
 assert.equal(link.args[2],'https://example.invalid');assert.equal(actions.filter(action=>action.operation==='openLink').length,1);
 for(const action of [copy,link]){
  assert.ok(nodes.some(node=>node.events?.click===action.token));
  const intent={id:action.token,event:'click',value:'forged',context};
  assert.deepEqual(directory.resolve(state,context,intent).args,action.args);
  assert.equal(directory.resolve({...state,timeline:[{...state.timeline[0],content:'Changed message'}]},context,intent),null);
 }
});

test('literal tool output never creates rich-text actions, while reasoning retains them', async () => {
 const state=JSON.parse(await readFile('fixtures/presentation-workbench/conversation.json','utf8'));
 const message=state.timeline[0];
 state.timeline=[{...message,id:'tool',role:'tool',toolName:'commandExecution',content},
  {...message,id:'reasoning',role:'system',toolName:'reasoning',content}];
 state.timelineVisibleCount=80;
 const actions=createConversationDirectory().project(state);
 assert.equal(actions.filter(a=>['copyCode','openLink'].includes(a.operation)&&a.args[0]==='tool').length,0);
 assert.ok(actions.some(a=>a.operation==='copyCode'&&a.args[0]==='reasoning'));
 assert.ok(actions.some(a=>a.operation==='openLink'&&a.args[0]==='reasoning'));
});

test('draft edits and streaming updates reuse unchanged message parsing and revoke changed actions', async t => {
 const {Lexer}=await import('marked');
 const lex=t.mock.method(Lexer,'lex');
 const state=JSON.parse(await readFile('fixtures/presentation-workbench/conversation.json','utf8'));
 state.timeline=[{...state.timeline[0],content:'[stable](https://stable.invalid)\n\n```js\ncacheRegression();\n```'},
  {...state.timeline[0],id:'stream',content:'[old](https://stream.invalid/old)',status:'streaming'}];
 state.timelineVisibleCount=80;
 const directory=createConversationDirectory(),context={workspaceId:'w',sessionId:'s',revision:1};
 const initial=directory.project(state),calls=lex.mock.callCount();
 const old=initial.find(a=>a.operation==='openLink'&&a.args[0]==='stream');
 for(let i=0;i<20;i++){
  const next={...state,draft:'x'.repeat(i)};
  const actions=directory.project(next);
  renderRichText(state.timeline[0].content,'message:m','m',actions);
  directory.resolve(next,context,{id:actions.find(a=>a.operation==='draft').token,event:'input',value:'x',context});
 }
 assert.equal(lex.mock.callCount(),calls,'typing, action validation and rendering do not lex unchanged history');
 state.timeline[1]={...state.timeline[1],content:'[new](https://stream.invalid/new)'};
 assert.equal(directory.resolve(state,context,{id:old.token,event:'click',context}),null);
 assert.equal(lex.mock.callCount(),calls+1,'only the updated message is re-parsed');
 assert.ok(directory.project(state).some(a=>a.operation==='openLink'&&a.args[2]==='https://stream.invalid/new'));
});

test('parsed history cache bounds entry count and retained source length', async t => {
 const {Lexer}=await import('marked');const lex=t.mock.method(Lexer,'lex');
 const first='cache eviction first';parseMarkdown(first);
 for(let i=0;i<300;i++)parseMarkdown('cache eviction '+i);
 let calls=lex.mock.callCount();parseMarkdown(first);
 assert.equal(lex.mock.callCount(),calls+1,'old entries leave the bounded cache');
 const large=' '.repeat(513*1024);
 calls=lex.mock.callCount();parseMarkdown(large);parseMarkdown(large);
 assert.equal(lex.mock.callCount(),calls+2,'oversized messages are not retained');
 const sized='cache size eviction';parseMarkdown(sized);
 for(let i=0;i<60;i++)parseMarkdown(' '.repeat(10000)+'size '+i);
 calls=lex.mock.callCount();parseMarkdown(sized);
 assert.equal(lex.mock.callCount(),calls+1,'total source size also bounds retention');
});
