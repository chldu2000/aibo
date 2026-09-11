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
