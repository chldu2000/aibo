import test from 'node:test';
import assert from 'node:assert/strict';
import { installFrontendDiagnostics } from '../src/lib/frontend-diagnostics.ts';
import { createDiagnosticLogsController } from '../src/lib/app/diagnostic-logs-controller.ts';

test('frontend reports categories and safe positions without reading messages or rejection reasons', async () => {
  const target = new EventTarget(); target.location = { href: 'http://localhost/', origin: 'http://localhost' };
  const reports = []; const stop = installFrontendDiagnostics(target, async value => { reports.push(value); throw Error('Reporting failure'); });
  const error = new Event('error'); Object.assign(error, { filename: 'http://localhost/src/main.ts?token-canary#fragment-canary', lineno: 5, colno: 8 });
  Object.defineProperty(error, 'message', { get() { throw Error('Message must not be accessed'); } });
  target.dispatchEvent(error);
  const rejection = new Event('unhandledrejection'); Object.defineProperty(rejection, 'reason', { get() { throw Error('Rejection must not be accessed'); } });
  target.dispatchEvent(rejection);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(reports, [{ kind: 'exception', resource: 'src/main.ts', line: 5, column: 8 }, { kind: 'unhandled_rejection' }]);
  stop(); target.dispatchEvent(error); assert.equal(reports.length, 2);
});

test('log state reads and directory actions recover independently without plugin ports', async () => {
  let state, fail = false, opens = 0;
  const value = { directory: '/profile/logs', state: 'degraded', error_code: 'quota_exhausted', dropped: 7, shutdown_complete: false };
  const controller = createDiagnosticLogsController({ read: async () => { if (fail) throw Error('read fixture'); return value; }, open: async () => { opens++; if (fail) throw Error('open fixture'); }, publish: value => { state = value; } });
  await controller.load(); assert.deepEqual(state.status, value);
  fail = true; await controller.load(); assert.deepEqual(state.status, value); assert.equal(state.error, 'read fixture');
  await controller.open(); assert.equal(state.error, 'open fixture'); assert.equal(state.opening, false);
  fail = false; await controller.open(); assert.equal(state.error, null); assert.equal(opens, 2);
  await controller.load(); assert.equal(state.loading, false); assert.equal(state.error, null);
});
