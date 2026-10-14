import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Execute the actual detached initialization task with injected desktop ports.
// Mount's promise cannot observe a rejection from this task.
const source = readFileSync(new URL('../src/App.svelte', import.meta.url), 'utf8');
const listener = source.indexOf('const unlisten = await listenToAgentEvents(handleAgentEvent);');
assert(listener >= 0);
const opening = 'void (async () => {';
const start = source.lastIndexOf(opening, listener) + opening.length;
const end = source.indexOf('})();', listener);
assert(start >= opening.length && end > start);
const createStartup = new Function('ports', `
  const { isTauri, listenToAgentEvents, refresh, diagnosticFrontendReady,
    diagnosticFrontendFailed, readPersistedSelection, toErrorText } = ports;
  const handleAgentEvent = () => {};
  let disposed = false, restoringSelection = false, desktop = false;
  let persistedSelection, stopListening, errorMessage = null;
  return {
    run: () => (async () => { ${source.slice(start, end)} })(),
    dispose: () => { disposed = true; },
    state: () => ({ restoringSelection, desktop, stopListening, errorMessage }),
  };
`);

function fixture(overrides = {}) {
  const calls = [];
  const startup = createStartup({
    isTauri: () => true,
    readPersistedSelection: () => null,
    toErrorText: error => error.message,
    listenToAgentEvents: async () => () => calls.push('unlisten'),
    refresh: async () => { calls.push('refresh'); },
    diagnosticFrontendReady: async () => { calls.push('ready'); },
    diagnosticFrontendFailed: async () => { calls.push('failed'); },
    ...overrides,
  });
  return { startup, calls };
}

test('listener registration failure reports startup failure, displays the error and clears restoration', async () => {
  const { startup, calls } = fixture({ listenToAgentEvents: async () => { throw Error('listener fixture'); } });
  await startup.run();
  assert.deepEqual(calls, ['failed']);
  assert.equal(startup.state().errorMessage, 'listener fixture');
  assert.equal(startup.state().restoringSelection, false);
});

test('failed diagnostic reporting does not hide the original startup error', async () => {
  const { startup } = fixture({
    listenToAgentEvents: async () => { throw Error('listener fixture'); },
    diagnosticFrontendFailed: async () => { throw Error('reporting fixture'); },
  });
  await startup.run();
  assert.equal(startup.state().errorMessage, 'listener fixture');
  assert.equal(startup.state().restoringSelection, false);
});

test('successful startup refreshes before reporting ready and retains listener cleanup', async () => {
  const { startup, calls } = fixture();
  await startup.run();
  assert.deepEqual(calls, ['refresh', 'ready']);
  assert.equal(startup.state().errorMessage, null);
  assert.equal(startup.state().restoringSelection, false);
  startup.state().stopListening();
  assert.deepEqual(calls, ['refresh', 'ready', 'unlisten']);
});

test('unexpected initial refresh failure reports failed without reporting ready', async () => {
  const { startup, calls } = fixture({ refresh: async () => { throw Error('refresh fixture'); } });
  await startup.run();
  assert.deepEqual(calls, ['failed']);
  assert.equal(startup.state().errorMessage, 'refresh fixture');
  assert.equal(startup.state().restoringSelection, false);
});

test('listener failure after disposal does not report failure or update the visible error', async () => {
  let reject;
  const { startup, calls } = fixture({ listenToAgentEvents: () => new Promise((_, fail) => { reject = fail; }) });
  const pending = startup.run();
  startup.dispose();
  reject(Error('late fixture'));
  await pending;
  assert.deepEqual(calls, []);
  assert.equal(startup.state().errorMessage, null);
  assert.equal(startup.state().restoringSelection, false);
});

test('listener registration completed after disposal releases the listener without reporting ready', async () => {
  let resolve;
  const { startup, calls } = fixture({ listenToAgentEvents: () => new Promise(done => { resolve = done; }) });
  const pending = startup.run();
  startup.dispose();
  resolve(() => calls.push('unlisten'));
  await pending;
  assert.deepEqual(calls, ['unlisten']);
  assert.equal(startup.state().restoringSelection, false);
});
