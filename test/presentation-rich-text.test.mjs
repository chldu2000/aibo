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
