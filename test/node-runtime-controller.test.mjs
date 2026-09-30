import test from 'node:test';
import assert from 'node:assert/strict';
import { createNodeRuntimeController } from '../src/lib/app/node-runtime-controller.ts';
const missing = { selected: null, manualPath: null, hostRequirement: '>=22', downloadVersion: '24.18.0', downloadSupported: true, issues: ['Node missing'] };
const ready = { ...missing, selected: { path: '/app/node', version: '24.18.0', source: 'managed' }, issues: [] };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return {promise,resolve}; };

test('downloads serialize with refresh and selection, publish confirmed results and refresh plugin availability', async () => {
  let state, refreshes = 0, selections = 0; const pending = deferred();
  const controller = createNodeRuntimeController({ read: async () => missing, select: async () => { selections++; return ready; }, download: () => pending.promise, pick: async () => '/node', refreshDependencies: async () => {refreshes++;}, changed: value => {state=value;} });
  await controller.load(); const download = controller.download();
  assert.equal(state.pending, 'download'); assert.equal(state.value.selected, null);
  await controller.choose(); await controller.load(); assert.equal(selections, 0);
  pending.resolve(ready); await download;
  assert.deepEqual(state.value, ready); assert.equal(state.pending, null); assert.equal(refreshes, 2);
});

test('failed download retains state, allows retry, and clears stale errors after recovery', async () => {
  let state, fail = true;
  const controller = createNodeRuntimeController({ read: async () => missing, select: async () => ready, download: async () => { if(fail)throw Error('checksum mismatch'); return ready; }, pick: async () => null, refreshDependencies: async () => {}, changed: value => {state=value;} });
  await controller.load(); await controller.download(); assert.equal(state.error, 'checksum mismatch'); assert.equal(state.value.selected, null);
  fail = false; await controller.download(); assert.equal(state.error, null); assert.deepEqual(state.value, ready);
});

test('cancelled picker does not clear settings; explicit automatic selection does', async () => {
  let state, selected = [], pick = null;
  const controller = createNodeRuntimeController({ read: async () => ready, select: async path => { selected.push(path); return { ...ready, manualPath: path }; }, download: async () => ready, pick: async () => pick, refreshDependencies: async () => {}, changed: value => {state=value;} });
  await controller.load(); await controller.choose(); assert.deepEqual(selected, []);
  pick = '/custom path/node'; await controller.choose(); assert.equal(state.value.manualPath, pick);
  await controller.automatic(); assert.deepEqual(selected, [pick, null]); assert.equal(state.value.manualPath, null);
});
