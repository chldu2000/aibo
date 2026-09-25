import assert from 'node:assert/strict';
import test from 'node:test';
import { createHostConfirmationController, hostConfirmationCategories } from '../src/lib/app/host-confirmation-controller.ts';

const defaults = () => Object.fromEntries(hostConfirmationCategories.map(({ id }) => [id, 'always-allow']));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('host confirmation saves one category and displays only native-confirmed preferences', async () => {
  let state; const pending = deferred(); const calls = [];
  const controller = createHostConfirmationController({ read: async () => defaults(), save: (...args) => { calls.push(args); return pending.promise; }, changed: value => { state = value; } });
  await controller.load(); const saving = controller.save('git', 'ask');
  assert.equal(state.saving, true); assert.equal(state.value.git, 'always-allow');
  await controller.save('viewWrite', 'ask'); await controller.load();
  assert.deepEqual(calls, [['git', 'ask']]);
  pending.resolve({ ...defaults(), git: 'ask', projectAction: 'ask' }); await saving;
  assert.equal(state.value.git, 'ask'); assert.equal(state.value.projectAction, 'ask');
  assert.equal(state.value.viewWrite, 'always-allow'); assert.equal(state.saving, false);
});

test('failed save retains policy and a retry clears the error', async () => {
  let state, fail = true;
  const controller = createHostConfirmationController({ read: async () => ({ ...defaults(), git: 'ask' }), save: async (id, policy) => { if (fail) throw Error('disk full'); return { ...defaults(), [id]: policy }; }, changed: value => { state = value; } });
  await controller.load(); await controller.save('git', 'always-allow');
  assert.equal(state.value.git, 'ask'); assert.equal(state.error, 'disk full');
  fail = false; await controller.save('git', 'always-allow');
  assert.equal(state.value.git, 'always-allow'); assert.equal(state.error, null);
});

test('reopening reads current settings and ignores an older response', async () => {
  let state, count = 0; const reads = [deferred(), deferred()];
  const controller = createHostConfirmationController({ read: () => reads[count++].promise, save: async () => assert.fail(), changed: value => { state = value; } });
  const first = controller.load(); const second = controller.load();
  reads[1].resolve({ ...defaults(), viewWrite: 'ask' }); await second;
  reads[0].resolve(defaults()); await first;
  assert.equal(state.value.viewWrite, 'ask'); assert.equal(state.loading, false);
});

test('missing, malformed, or failed reads disable settings instead of implying approval', async () => {
  for (const response of [null, {}, { ...defaults(), git: 'unknown' }, Error('unavailable')]) {
    let state;
    const controller = createHostConfirmationController({ read: async () => { if (response instanceof Error) throw response; return response; }, save: async () => assert.fail('must not save'), changed: value => { state = value; } });
    await controller.load(); await controller.save('git', 'always-allow');
    assert.equal(state.value, null); assert(state.error); assert.equal(state.loading, false);
  }
});
