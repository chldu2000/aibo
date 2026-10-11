import assert from 'node:assert/strict';
import test from 'node:test';
import { runtimeDiagnostics } from '../src/lib/app/runtime-diagnostics.ts';
const auth = { busyId: null, entries: {} };
const provider = id => ({ id, kind: 'capabilityProvider', scope: 'session', metadata: { displayName: id, operations: [{ capability: { id: 'aibo.session.open' } }] } });
const installation = (patch = {}) => ({ id: 'third-release', installed: true, enabled: true, runnable: true, dependencies: [], manifest: { displayName: 'Third party' }, contributions: [provider('one'), provider('two')], ...patch });

test('third-party diagnostics use installation and contribution facts without inferring transport or connectivity', () => {
  const source = installation({ packageDependencies: { dependencies: [], unavailableContributions: ['two'] } });
  const [result] = runtimeDiagnostics([source], auth, 'en');
  assert.equal(result.status, 'attention');
  assert.deepEqual(result.providers, ['one', 'two']);
  assert.deepEqual(result.issues, ['Unavailable contribution: two']);
  assert.match(result.auth, /unknown/);
  assert.equal(result.channel, undefined);
  assert.deepEqual(source.packageDependencies.unavailableContributions, ['two']);
});
test('disabled and removed plugins do not generate attention; optional dependencies remain explicit', () => {
  const dependencies = [{ name: 'optional runtime', available: false, required: false, issue: 'missing' }];
  const rows = runtimeDiagnostics([installation({ dependencies }), installation({ id: 'disabled', enabled: false, runnable: false, dependencies }), installation({ id: 'removed', installed: false })], auth, 'en');
  assert.deepEqual(rows.map(row => row.status), ['attention', 'disabled']);
  assert.match(rows[0].issues[0], /Optional dependency/);
});
test('unknown, pending, failed and checked authentication remain distinct and installation-scoped', () => {
  const item = installation({ manifest: { displayName: 'Third', authentication: {} } });
  const row = entries => runtimeDiagnostics([item], { ...auth, entries }, 'en')[0];
  assert.equal(row({}).status, 'unchecked');
  assert.equal(row({ other: { result: 'authenticated', error: '' } }).status, 'unchecked');
  assert.equal(row({ 'third-release': { result: 'loginOpened', error: '' } }).status, 'unchecked');
  assert.equal(row({ 'third-release': { result: 'unauthenticated', error: '' } }).status, 'attention');
  assert.deepEqual(row({ 'third-release': { error: 'check failed' } }).issues, ['check failed']);
  const checked = row({ 'third-release': { result: 'authenticated', checkedAt: 123, error: '' } });
  assert.equal(checked.status, 'checked');
  assert.equal(checked.authCheckedAt, 123);
  assert.match(checked.auth, /last authentication check/);
});
test('native localized dependency and activation results are reused and unavailable runtime has a fallback', () => {
  const [result] = runtimeDiagnostics([installation({ runnable: false, dependencies: [{ name: 'node', required: true, available: false, issue: 'original', localizedIssue: { schema: 'aibo.host-message/v1', key: 'native.settings.storageUnavailable', params: {} } }] })], auth, 'en');
  assert.match(result.issues[0], /Configuration storage is unavailable/);
  assert.equal(runtimeDiagnostics([installation({ runnable: false })], auth, 'en')[0].status, 'attention');
});
