import test from 'node:test';
import assert from 'node:assert/strict';
import {linkTarget} from '../packages/presentation-workbench/links.js';
import {markdownTargets,inlineSegments} from '../packages/presentation-workbench/markdown.js';
import {createFilePreviewController} from '../src/lib/app/file-preview-controller.ts';
import {createConversationDirectory} from '../src/lib/presentation-runtime/conversation.ts';
import {readFile} from 'node:fs/promises';

test('explicit local links resolve locations, encoded names and Windows drive letters', () => {
  for (const [href,path,line,column] of [
    ['/tmp/main.ts:42','/tmp/main.ts',42,null],['src/main.ts#L8-L12','src/main.ts',8,null],
    ['main.ts:9:3','main.ts',9,3],['./文档%20一.md','./文档 一.md',null,null],
    ['file:///tmp/%E6%96%87%E4%BB%B6.ts#L7','/tmp/文件.ts',7,null],
    ['file://localhost/tmp/main.ts:12','/tmp/main.ts',12,null],
    ['C:\\work\\main.ts:9','C:\\work\\main.ts',9,null],['file:///C:/work/main.ts','C:/work/main.ts',null,null],
  ]) assert.deepEqual(linkTarget(href),{kind:'file',path,line,column},href);
  for (const href of ['javascript:123','javascript:alert(1)','data:text/html,x','ssh://host/x','file://remote/a','//remote/a','#heading','%00.txt','file:///tmp/a?query','x.ts:9999999999999']) assert.equal(linkTarget(href),null,href);
  assert.equal(linkTarget('https://example.com/a#L8').kind,'web');
  assert.equal(linkTarget('mailto:me@example.com').kind,'email');
  assert.deepEqual(markdownTargets('plain src/file.ts:12 and `/tmp/file`'),[]);
  assert.equal(inlineSegments('[local](</tmp/a b.ts:12>)')[0].kind,'link');
});

test('file link actions are current-message bound and revoked when a destination changes', async () => {
  const state = JSON.parse(await readFile('fixtures/presentation-workbench/conversation.json','utf8'));
  state.timeline = [{...state.timeline[0],id:'entry',content:'[file](src/main.ts:42)'}]; state.timelineVisibleCount = 1;
  const directory = createConversationDirectory();
  const action = directory.project(state).find(action => action.operation === 'openLink');
  assert.equal(action.args[2],'src/main.ts:42');
  const context = {workspaceId:state.workspace?.id ?? null,sessionId:state.session?.id ?? null,revision:1};
  const intent = {id:action.token,event:'click',context};
  assert.ok(directory.resolve(state,context,intent));
  state.timeline[0].content = '[file](src/other.ts:42)';
  assert.equal(directory.resolve(state,context,intent),null);
});

test('preview controller discards reads after replacement, close, and session changes; failures can retry', async () => {
  let state;
  const pending = [];
  const controller = createFilePreviewController((sessionId,path,line) => new Promise((resolve,reject) => pending.push({sessionId,path,line,resolve,reject})), value => {state=value;});
  const first = controller.open('s1','a.ts',42);
  const second = controller.open('s1','b.ts',5);
  pending[0].resolve({path:'a.ts'}); await first;
  assert.equal(state.path,'b.ts'); assert.equal(state.loading,true);
  pending[1].reject({code:'session_operation',message:'missing'}); await second;
  assert.match(state.error,/missing/);
  const retry = controller.open('s1','b.ts',5);
  assert.equal(state.error,null);
  pending[2].resolve({path:'b.ts',targetLine:5}); await retry;
  assert.equal(state.preview.targetLine,5);
  const closed = controller.open('s1','a.ts'); controller.close();
  pending[3].resolve({path:'a.ts'}); await closed; assert.equal(state.path,null);
  const old = controller.open('s1','a.ts'); controller.close();
  const current = controller.open('s2','a.ts');
  pending[4].reject(Error('old error')); await old; assert.equal(state.sessionId,'s2'); assert.equal(state.error,null);
  pending[5].resolve({path:'a.ts'}); await current;
});
