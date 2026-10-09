import { translateMessage } from '../packages/i18n/index.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createInstalledController } from '../src/lib/presentation/installed-controller.ts';
const snapshot = JSON.parse(await readFile(new URL('../fixtures/semantic-git/collection.json', import.meta.url), 'utf8'));
const contribution = { installationId: 'release', contributionId: snapshot.context.contributionId, title: 'Installed tool', available: true, issue: null };
const pending = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
test('installed controller releases late opens after workspace navigation and disposal', async () => {
  const first = pending(), second = pending(), released = [], published = [];
  let count = 0;
  const controller = createInstalledController({ cancelOpen: async () => {}, open: () => (++count === 1 ? first.promise : second.promise), act: async () => snapshot, release: async id => { released.push(id); } }, value => published.push(value));
  const a = controller.open('a', contribution), b = controller.open('b', contribution);
  second.resolve({ ...snapshot, context: { ...snapshot.context, workspaceId: 'b', generation: 'b' } }); await b;
  first.resolve({ ...snapshot, context: { ...snapshot.context, workspaceId: 'a', generation: 'a' } }); await a;
  assert.equal(published.at(-1).context.workspaceId, 'b'); assert.ok(released.includes('a'));
  controller.dispose(); assert.ok(released.includes('b'));
});
test('installed controller rejects a provider changing host context and releases the lease', async () => {
  const released = [], errors = [];
  const controller = createInstalledController({ cancelOpen: async () => {}, open: async () => snapshot, act: async () => ({ ...snapshot, context: { ...snapshot.context, generation: 'forged', revision: snapshot.context.revision + 1 } }), release: async id => { released.push(id); } }, (_, error) => errors.push(error));
  await controller.open(snapshot.context.workspaceId, contribution);
  await controller.act({ context: snapshot.context, actionId: 'refresh', itemId: null });
  assert.match(translateMessage('zh-CN', errors.at(-1)), /无法显示/); assert.ok(released.includes(snapshot.context.generation));
});

test('closing a pending initial open cancels by request ID before a generation is returned', async () => {
  const task = pending(), cancelled = [], released = [];
  let request;
  const controller = createInstalledController({ open: async (_, __, ___, id) => { request = id; return task.promise; }, cancelOpen: async id => cancelled.push(id), release: async id => released.push(id), act: async () => snapshot }, () => {});
  const opening = controller.open(snapshot.context.workspaceId, contribution);
  controller.dispose();
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.ok(cancelled.includes(request));
  task.resolve(snapshot); await opening;
  assert.ok(released.includes(snapshot.context.generation));
});

const writable = () => ({ ...snapshot, schema: 'aibo.semantic-view/v1.1', actions: [...snapshot.actions, { id: 'example.write', label: 'Write', intent: 'execute', enabled: true, input: { value: 'frozen' } }] });
test('installed write coalesces repeated clicks and refreshes only after completion', async () => {
  const view = writable(), task = pending(), writes = [], reads = [], published = [];
  const controller = createInstalledController({ cancelOpen: async () => {}, release: async () => {}, open: async () => view,
    write: async (...args) => { writes.push(args); await task.promise; },
    act: async action => { reads.push(action); return { ...view, context: { ...view.context, revision: view.context.revision + 1 } }; }
  }, (value, error) => published.push({ value, error }));
  await controller.open(view.context.workspaceId, contribution);
  const action = { context: view.context, actionId: 'example.write', itemId: null };
  const first = controller.act(action), second = controller.act(action);
  assert.equal(first, second); assert.equal(writes.length, 1); assert.equal(reads.length, 0);
  assert.deepEqual(writes[0][0], action); assert.match(writes[0][1], /^[0-9a-f-]{36}$/);
  task.resolve(); await first;
  assert.equal(reads[0].actionId, 'refresh'); assert.equal(published.at(-1).value.context.revision, view.context.revision + 1);
});
test('completed write with failed refresh remains visible and cannot blindly repeat', async () => {
  const view = writable(); let writes = 0, last;
  const controller = createInstalledController({ cancelOpen: async () => {}, release: async () => {}, open: async () => view,
    write: async () => { writes++; }, act: async () => { throw Error('timeout'); }
  }, (value, error) => { last = { value, error }; });
  await controller.open(view.context.workspaceId, contribution);
  const action = { context: view.context, actionId: 'example.write', itemId: null };
  await controller.act(action);
  assert.match(translateMessage('zh-CN', last.error), /写入已完成，但刷新失败/);
  assert.equal(last.value.actions.find(action => action.id === 'example.write').enabled, false);
  await controller.act(action); assert.equal(writes, 1);
});
test('closing a write releases the view without refreshing or publishing its late result', async () => {
  const view = writable(), task = pending(), released = []; let reads = 0, publications = 0;
  const controller = createInstalledController({ cancelOpen: async () => {}, release: async id => { released.push(id); }, open: async () => view,
    write: async () => task.promise, act: async () => { reads++; return view; }
  }, () => { publications++; });
  await controller.open(view.context.workspaceId, contribution);
  const writing = controller.act({ context: view.context, actionId: 'example.write', itemId: null });
  controller.dispose(); const before = publications;
  task.resolve(); await writing;
  assert.equal(reads, 0); assert.equal(publications, before); assert.deepEqual(released, [view.context.generation]);
});

test('unknown write outcome preserves read access and blocks automatic retry', async () => {
  const view = writable(); let writes = 0, last;
  const controller = createInstalledController({ cancelOpen: async () => {}, release: async () => {}, open: async () => view,
    write: async () => { writes++; throw Error('outcome_unknown: process lost'); },
    act: async () => ({ ...view, context: { ...view.context, revision: view.context.revision + 1 } })
  }, (value, error) => { last = { value, error }; });
  await controller.open(view.context.workspaceId, contribution);
  const action = { context: view.context, actionId: 'example.write', itemId: null };
  await controller.act(action); assert.match(translateMessage('zh-CN', last.error), /结果未知/);
  await controller.act(action); assert.equal(writes, 1);
  assert.equal(last.value.actions.find(action => action.id === 'refresh').enabled, true);
  await controller.act({ ...action, actionId: 'refresh' });
  assert.equal(last.value.context.revision, view.context.revision + 1);
});


test('installed read errors retain explicit host metadata and recognize only protocol codes',async()=>{
 for(const [error,key] of [
  [{code:'busy',message:'原始诊断'},'installed.busy'],
  ['busy: diagnostic','installed.busy'],
  [Error('timeout: diagnostic'),'installed.timeout'],
  [{code:'other',message:'busy: provider text'},'installed.readFailed'],
  ['provider details mention permission_denied and timeout','installed.readFailed'],
  [Error('provider mentions invalid_output'),'installed.readFailed'],
  [{code:'session_operation_error',message:'原文',localized:{schema:'aibo.host-message/v1',key:'native.search.binaryPreview',params:{}}},'native.search.binaryPreview'],
 ]) {
  let last;const controller=createInstalledController({cancelOpen:async()=>{},open:async()=>{throw error},act:async()=>snapshot,release:async()=>{}},(_,failure)=>last=failure);
  await controller.open(snapshot.context.workspaceId,contribution);assert.equal(last.key,key);
  assert.equal(typeof translateMessage('en',last),'string');assert.equal(typeof translateMessage('zh-CN',last),'string');controller.dispose();
 }
});

test('structured write failures keep their localized outcome and never repeat a write',async()=>{
 for(const [error,key] of [
  [{code:'outcome_unknown',message:'原始诊断'},'installed.writeUnknown'],
  [{code:'outcome_unknown',message:'原始诊断',localized:{schema:'aibo.host-message/v1',key:'native.broker.writeUnconfirmed',params:{code:'provider_raw {code}'}}},'installed.writeUnknownDetail'],
  [{code:'approval_rejected',message:'原始诊断'},'installed.writeRejected'],
  [{message:'outcome_unknown: 原始诊断'},'installed.writeUnknown'],
  [{message:'outcome_unknown: 原始诊断',localized:{schema:'aibo.host-message/v1',key:'native.broker.writeUnconfirmed',params:{code:'provider_raw {code}'}}},'installed.writeUnknownDetail'],
  [{message:'approval_rejected: 原始诊断',localized:{schema:'aibo.host-message/v1',key:'native.semanticWrite.disabled',params:{}}},'installed.writeRejected'],
  [{message:'outcome_unknown: 原始诊断',localized:{schema:'invalid',key:'native.semanticWrite.taskStopped',params:{}}},'installed.writeUnknown'],
  [{message:'provider mentions outcome_unknown and approval_rejected'},'installed.writeFailed'],
  [{code:'other',message:'diagnostic mentions outcome_unknown'},'installed.writeFailed'],
  ['provider text mentions approval_rejected','installed.writeFailed'],
  [{code:'workspace_trust_required',message:'原文',localized:{schema:'aibo.host-message/v1',key:'native.error.workspaceTrust',params:{}}},'native.error.workspaceTrust'],
 ]) {
  const view=writable();let writes=0,last;const controller=createInstalledController({cancelOpen:async()=>{},open:async()=>view,release:async()=>{},write:async()=>{writes++;throw error},act:async()=>({...view,context:{...view.context,revision:view.context.revision+1}})},(value,failure)=>last={value,failure});
  await controller.open(view.context.workspaceId,contribution);const action={context:view.context,actionId:'example.write',itemId:null};await controller.act(action);
  assert.equal(last.failure.key,key);assert.notEqual(translateMessage('en',last.failure),translateMessage('zh-CN',last.failure));
  if(key==='installed.writeUnknownDetail'){
   assert.ok(translateMessage('en',last.failure).startsWith('The write outcome is unknown. Check execution history and verify the result before retrying.'));
   assert.ok(translateMessage('en',last.failure).includes('provider_raw {code}'));
   assert.ok(translateMessage('zh-CN',last.failure).includes('已批准的能力执行未产生确认结果'));
  }
  assert.equal(last.value.actions.find(item=>item.id==='example.write').enabled,false);assert.equal(last.value.actions.find(item=>item.id==='refresh').enabled,true);
  await controller.act(action);assert.equal(writes,1);controller.dispose();
 }
});
