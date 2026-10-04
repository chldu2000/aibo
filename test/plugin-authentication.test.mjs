import assert from 'node:assert/strict';
import test from 'node:test';
import { createPluginAuthenticationController } from '../src/lib/app/plugin-authentication-controller.ts';

function fixture(execute) {
  let state;
  const controller = createPluginAuthenticationController({ execute, publish: value => { state = value; } });
  return { controller, get state() { return state; } };
}
test('opening login is not authentication and results stay bound to their installation', async () => {
  const f = fixture(async (id, action) => action === 'login' ? 'loginOpened' : id === 'one' ? 'authenticated' : 'unauthenticated');
  await f.controller.run('one', 'login');
  assert.equal(f.state.entries.one.result, 'loginOpened');
  await f.controller.run('two', 'status');
  assert.equal(f.state.entries.two.result, 'unauthenticated');
  assert.equal(f.state.entries.one.result, 'loginOpened');
  await f.controller.run('one', 'status');
  assert.equal(f.state.entries.one.result, 'authenticated');
});
test('duplicate requests are blocked and a successful retry clears the prior error', async () => {
  let finish, calls = 0;
  const f = fixture(() => { ++calls; return new Promise((resolve, reject) => { finish = { resolve, reject }; }); });
  const pending = f.controller.run('one', 'login');
  await f.controller.run('one', 'login');
  await f.controller.run('two', 'status');
  assert.equal(calls, 1);
  finish.reject(Error('terminal unavailable')); await pending;
  assert.equal(f.state.busyId, null);
  assert.equal(f.state.entries.one.error, 'terminal unavailable');
  const retry = f.controller.run('one', 'login');
  assert.equal(f.state.entries.one.error, '');
  finish.resolve('loginOpened'); await retry;
  assert.equal(f.state.entries.one.result, 'loginOpened');
});
