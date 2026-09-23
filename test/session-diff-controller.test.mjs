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
  assert.deepEqual(reads[1].args, ['w', 'same.txt', true, 'second']);
  reads[1].resolve({ diff: 'current' }); await next;
  reads[0].resolve({ diff: 'stale' }); await old;
  assert.equal(state.diff.diff, 'current');
  controller.close(); assert.deepEqual(state, emptySessionDiff());
});
test('failed reads surface errors and a successful retry clears them', async () => {
  let state; let fail = true;
  const controller = createSessionDiffController(async () => { if (fail) throw Error('unavailable'); return { diff: 'ok' }; }, value => state = value);
  await controller.open('w', 'repo', 'file', false);
  assert.match(state.error, /unavailable/); assert.equal(state.loading, false);
  fail = false; await controller.open('w', 'repo', 'file', false);
  assert.equal(state.error, null); assert.equal(state.diff.diff, 'ok');
});
