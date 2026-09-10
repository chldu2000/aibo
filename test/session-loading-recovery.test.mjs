import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { withTimeout } from '../src/lib/app/async-timeout.ts';
import { createLatestRequestTracker } from '../src/lib/app/latest-request-tracker.ts';
import { reconcileSessionRefresh } from '../src/lib/app/session-transitions.ts';

function session(id, state = 'idle') {
  return { id, state };
}

test('session request timeout rejects instead of leaving the UI pending forever', async () => {
  await assert.rejects(
    withTimeout(new Promise(() => {}), 5, 'session timeout'),
    /session timeout/,
  );
});

test('session request generations advance synchronously outside reactive UI state', () => {
  const tracker = createLatestRequestTracker();
  const first = tracker.begin('workspace');
  const second = tracker.begin('workspace');

  assert.equal(tracker.isLatest('workspace', first), false);
  assert.equal(tracker.isLatest('workspace', second), true);
  assert.equal(tracker.isLatest('other-workspace', second), false);
});

test('workspace sidebar preserves cached sessions while a refresh is pending', async () => {
  const source = await readFile(
    new URL('../src/lib/components/app/WorkspaceSidebar.svelte', import.meta.url),
    'utf8',
  );
  const cachedSessions = source.indexOf('{#if workspaceSessions.length > 0}');
  const loadingFallback = source.indexOf('{:else if sessionsLoadingWorkspaceIds.includes(workspace.id)}');

  assert.notEqual(cachedSessions, -1);
  assert.notEqual(loadingFallback, -1);
  assert.ok(cachedSessions < loadingFallback, 'cached sessions must render before the loading fallback');
  assert.match(source, /aria-busy=\{sessionsLoadingWorkspaceIds\.includes\(workspace\.id\)\}/);
});

test('nested session list cannot collapse into its own zero-height scroll container', async () => {
  const source = await readFile(
    new URL('../src/lib/ui-kit/kits/base.css', import.meta.url),
    'utf8',
  );
  const rule = source.match(/\.session-list\s*\{([^}]*)\}/)?.[1] ?? '';

  assert.ok(rule, 'the session-list layout rule must exist');
  assert.doesNotMatch(rule, /overflow-y\s*:\s*auto/);
  assert.doesNotMatch(rule, /min-height\s*:\s*0/);
  assert.match(source, /\.workspace-list\s*\{[^}]*overflow-y\s*:\s*auto/);
});

test('Pi creation timeout reloads and recovers a newly persisted idle session', async () => {
  const source = await readFile(
    new URL('../src/lib/app/agent-session-controller.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /await context\.refreshSessions\(workspace\.id\)/);
  assert.match(source, /!previousSessionIds\.has\(session\.id\)/);
  assert.match(source, /session\.state === 'idle'/);
  assert.match(source, /context\.setSelectedSessionId\(recovered\.id\)/);
});

test('an older empty refresh cannot erase a session created while it was pending', () => {
  const existing = session('existing');
  const created = session('created');

  assert.deepEqual(
    reconcileSessionRefresh([existing], [created, existing], []),
    [created],
  );
});

test('an older refresh cannot restore a locally removed session or revert an update', () => {
  const original = session('session', 'running');
  const updated = session('session', 'idle');
  const removed = session('removed');

  assert.deepEqual(
    reconcileSessionRefresh(
      [original, removed],
      [updated],
      [original, removed, session('server-only')],
    ),
    [updated, session('server-only')],
  );
});
