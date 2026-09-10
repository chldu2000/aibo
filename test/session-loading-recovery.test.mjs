import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { withTimeout } from '../src/lib/app/async-timeout.ts';

test('session request timeout rejects instead of leaving the UI pending forever', async () => {
  await assert.rejects(
    withTimeout(new Promise(() => {}), 5, 'session timeout'),
    /session timeout/,
  );
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
