import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseMarkdown, inlineSegments, markdownTargets} from '../packages/presentation-workbench/markdown.js';
import {highlightCode} from '../packages/presentation-workbench/code-highlight.js';
import {renderRichText} from '../packages/presentation-workbench/rich-text.js';
import {createConversationDirectory} from '../src/lib/presentation-runtime/conversation.ts';

const flatten = tree => [tree, ...(tree.children ?? []).flatMap(flatten)];
const text = tree => (tree.text ?? '') + (tree.children ?? []).map(text).join('');
const plain = segments => segments.map(segment => segment.children ? plain(segment.children) : segment.value).join('');
const fixture = await readFile('fixtures/markdown-technical.md', 'utf8');

test('technical Markdown preserves headings, ordered starts, nesting, tasks and aligned tables', () => {
  const blocks = parseMarkdown(fixture);
  assert.deepEqual(blocks.filter(block => block.kind === 'heading').map(block => block.level), [1,2,3,4,5,6]);
  const ordered = blocks.find(block => block.kind === 'list');
  assert.equal(ordered.ordered, true);
  assert.equal(ordered.start, 3);
  assert.equal(ordered.items[0].blocks[1].kind, 'list');
  assert.equal(ordered.items[0].blocks[1].items.length, 2);
  assert.deepEqual(blocks.filter(block => block.kind === 'list')[1].items.map(item => item.checked), [true,false]);
  const quote = blocks.find(block => block.kind === 'quote');
  assert.equal(quote.blocks[1].kind, 'list');
  const table = blocks.find(block => block.kind === 'table');
  assert.deepEqual(table.align, ['left','center','right']);
  assert.equal(plain(table.rows[1][2]), 'a|b');
  assert.ok(blocks.some(block => block.kind === 'rule'));
  const tree = renderRichText(fixture, 'technical', 'entry', []);
  const nodes = flatten(tree);
  assert.equal(new Set(nodes.map(node => node.key)).size, nodes.length);
  assert.equal(nodes.find(node => node.tag === 'ol').attrs.start, '3');
  assert.ok(nodes.some(node => node.tag === 'blockquote'));
  assert.ok(nodes.some(node => node.tag === 'h6'));
  assert.ok(nodes.some(node => node.tag === 'em'));
  assert.ok(!text(tree).includes('[x]'));
  assert.ok(!text(tree).includes('[ ]'));
  assert.ok(nodes.some(node => node.tag === 'del'));
  assert.equal(nodes.filter(node => node.tag === 'th' && node.attrs.scope === 'col').length, 3);
  assert.ok(nodes.some(node => node.tag === 'strong' && flatten(node).some(child => child.tag === 'code')));
});

test('nested links and code copies bind exact current content and revoke stale actions', async () => {
  const content = '> - **[nested](https://example.invalid/nested)**\n>\n>   ```js\n>   const first = 1;\n>   ```\n\n| link |\n| --- |\n| [cell](https://example.invalid/cell) |\n\n1. code\n\n   ```text\n   second block\n   ```';
  const state = JSON.parse(await readFile('fixtures/presentation-workbench/conversation.json','utf8'));
  state.timeline = [{...state.timeline[0],id:'entry',content}]; state.timelineVisibleCount = 1;
  const directory = createConversationDirectory(), actions = directory.project(state);
  const context = {workspaceId:'w',sessionId:'s',revision:1};
  const nodes = flatten(renderRichText(content,'message:entry','entry',actions));
  const targets = actions.filter(action => ['copyCode','openLink'].includes(action.operation));
  assert.equal(targets.length,4);
  assert.deepEqual(targets.filter(action => action.operation === 'copyCode').map(action => action.args[2]), ['const first = 1;','second block']);
  for (const action of targets) {
    assert.ok(nodes.some(node => node.events?.click === action.token));
    const intent = {id:action.token,event:'click',value:'forged',context};
    assert.deepEqual(directory.resolve(state,context,intent).args, action.args);
    assert.equal(directory.resolve({...state,timeline:[{...state.timeline[0],content:'replacement'}]},context,intent),null);
  }
});

test('escaping, entities, reference links and raw HTML remain text without unsafe actions', () => {
  assert.equal(plain(inlineSegments('a &amp; b \\*literal\\*')), 'a & b *literal*');
  assert.equal(plain(inlineSegments('`&amp; <script>`')), '&amp; <script>');
  for (const content of ['[bad](javascript:alert(1))','[bad](java&#x73;cript:alert)','[bad](data:text/html,test)','[bad](file:///tmp/test)','<img src=x onerror=alert(1)>']) {
    assert.deepEqual(markdownTargets(content),[]);
    const tree = renderRichText(content,'unsafe','entry',[]);
    assert.ok(!flatten(tree).some(node => node.events || node.tag === 'img' || node.tag === 'script'));
    assert.ok(text(tree).includes(content));
  }
  assert.equal(markdownTargets('[ref][docs]\n\n[docs]: https://example.invalid')[0].value,'https://example.invalid');
  assert.equal(markdownTargets('https://example.invalid')[0].kind,'link');
  const image = renderRichText('![diagram](https://example.invalid/image.png)','image','entry',[]);
  assert.ok(text(image).includes('图片：diagram'));
  assert.ok(!flatten(image).some(node => node.tag === 'img'));
});

test('fenced, indented and streaming code preserve source with safe highlight fallbacks', () => {
  for (const source of ['```ts\nconst x: number = 1;', '~~~ts\nconst x: number = 1;\n~~~', '    const x: number = 1;']) {
    const block = parseMarkdown(source)[0];
    assert.equal(block.kind,'code');
    assert.equal(block.lines.join('\n'),'const x: number = 1;');
  }
  const code = 'const answer: number = 42;\nconst text = "<script>";';
  const segments = highlightCode(code,'ts');
  assert.equal(plain(segments),code);
  assert.ok(segments.some(segment => segment.className?.includes('hljs-keyword')));
  assert.deepEqual(highlightCode(code,'unknown-language'),[{value:code}]);
  const large = 'const a = 1;\n'.repeat(5000);
  assert.deepEqual(highlightCode(large,'js'),[{value:large}]);
  for (let end = 1; end <= fixture.length; end += 23) {
    const tree = renderRichText(fixture.slice(0,end),'stream','entry',[]);
    assert.equal(new Set(flatten(tree).map(node => node.key)).size,flatten(tree).length);
  }
});

test('loose task lists render their checkbox once and keep paragraphs', () => {
  const tree = renderRichText('- [x] first\n\n  continuation\n\n- [ ] second','loose','entry',[]);
  const nodes = flatten(tree);
  assert.equal(nodes.filter(node => node.className === 'markdown-task-check').length,2);
  assert.ok(!text(tree).includes('[x]'));
  assert.ok(!text(tree).includes('[ ]'));
  assert.ok(text(tree).includes('continuation'));
});
