import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionDiffController, emptySessionDiff } from '../src/lib/app/session-diff-controller.ts';

test('session diff preserves repository and index selection; late reads cannot cross sessions', async () => {
  const reads = [];
  let state;
  const controller = createSessionDiffController((...args) => new Promise(resolve => reads.push({ args, resolve })), value => state = value);
  const old = controller.open('w', 'first', 'same.txt', false);
  controller.close();
  const next = controller.open('w', 'second', 'same.txt', true);
  assert.equal(state.repositoryId, 'second');
  assert.equal(state.path, 'same.txt');
  assert.equal(state.loading, true);
  assert.deepEqual(reads[1].args, ['w', 'same.txt', true, 'second']);
  reads[1].resolve({ diff: 'current' }); await next;
  reads[0].resolve({ diff: 'stale' }); await old;
  assert.equal(state.diff.diff, 'current');
  assert.equal(state.repositoryId, 'second');
  controller.close(); assert.deepEqual(state, emptySessionDiff());
});
test('collapsing a loading preview prevents late errors or results from reopening it', async () => {
  for (const fail of [false, true]) {
    let state, finish;
    const controller = createSessionDiffController(() => new Promise((resolve, reject) => { finish = () => fail ? reject(Error('late')) : resolve({diff:'late'}); }), value => state = value);
    const loading = controller.open('w', 'repo', 'file', false);
    controller.close(); finish(); await loading;
    assert.deepEqual(state, emptySessionDiff());
  }
});
test('failed reads surface errors and a successful retry clears them', async () => {
  let state; let fail = true;
  const controller = createSessionDiffController(async () => { if (fail) throw Error('unavailable'); return { diff: 'ok' }; }, value => state = value);
  await controller.open('w', 'repo', 'file', false);
  assert.match(state.error, /unavailable/); assert.equal(state.loading, false);
  fail = false; await controller.open('w', 'repo', 'file', false);
  assert.equal(state.error, null); assert.equal(state.diff.diff, 'ok');
});
