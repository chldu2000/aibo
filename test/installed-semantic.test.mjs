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
  assert.match(errors.at(-1), /无法显示/); assert.ok(released.includes(snapshot.context.generation));
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
  assert.match(last.error, /写入已完成，但刷新失败/);
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
  await controller.act(action); assert.match(last.error, /结果未知/);
  await controller.act(action); assert.equal(writes, 1);
  assert.equal(last.value.actions.find(action => action.id === 'refresh').enabled, true);
  await controller.act({ ...action, actionId: 'refresh' });
  assert.equal(last.value.context.revision, view.context.revision + 1);
});
