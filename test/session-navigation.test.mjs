import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

test('workspace disclosure and session navigation keep separate contexts', async () => {
  const server = await createServer({ server: { middlewareMode: true, ws: false, watch: null }, appType: 'custom' });
  try {
    const { createNavigationController } = await server.ssrLoadModule('/src/lib/app/navigation-controller.ts');
    let workspace = 'a', selected = 'a1', expanded = ['a'], creator = null;
    const calls = [];
    const records = [{ id: 'a1', workspaceId: 'a' }, { id: 'b1', workspaceId: 'b' }];
    const context = {
      getDesktop: () => true,
      getSelectedWorkspaceId: () => workspace,
      getExpandedWorkspaceIds: () => expanded,
      getCreateSessionWorkspaceId: () => creator,
      getArchivingSessionId: () => null,
      findSession: id => records.find(record => record.id === id),
      setSelectedWorkspaceId: value => { workspace = value; },
      setSelectedSessionId: value => { selected = value; },
      setExpandedWorkspaceIds: value => { expanded = value; },
      setCreateSessionWorkspaceId: value => { creator = value; },
      clearSelectedSessionContext: () => { selected = null; },
    };
    for (const name of ['setTimelineVisibleCount', 'setCodexThreads', 'setProjectActions',
      'setProjectActionRuns', 'setWorkspaceCapabilities', 'setNotice', 'refreshSessions',
      'refreshCodexThreads', 'refreshTimeline', 'refreshCodexThread', 'refreshPiTree',
      'refreshExecutionProfile', 'refreshTurnChangeSet', 'refreshAttachments', 'refreshArtifacts',
      'refreshProjectActions', 'refreshWorkspaceCapabilities', 'refreshWorkspaceChanges']) {
      context[name] = value => { calls.push([name, value]); };
    }
    const controller = createNavigationController(context);
    controller.selectWorkspace('b');
    assert.equal(workspace, 'a');
    assert.equal(selected, 'a1');
    assert.deepEqual(calls, [['refreshSessions', 'b'], ['setNotice', null]]);
    controller.toggleSessionCreator('b');
    assert.equal(workspace, 'a');
    assert.equal(selected, 'a1');
    assert.equal(creator, 'b');
    calls.length = 0;
    controller.selectSession('b1');
    assert.equal(workspace, 'b');
    assert.equal(selected, 'b1');
    assert.equal(creator, null);
    assert.ok(calls.some(([name, id]) => name === 'refreshTimeline' && id === 'b1'));
    assert.ok(calls.some(([name, id]) => name === 'refreshWorkspaceCapabilities' && id === 'b'));
    assert.ok(!calls.some(([name]) => name === 'refreshSessions'));
    calls.length = 0;
    controller.selectWorkspace('a');
    assert.equal(workspace, 'b');
    assert.equal(selected, 'b1');
    assert.deepEqual(calls, [['setNotice', null]]);
  } finally { await server.close(); }
});

test('pending workspace refresh cannot clear a session selected after loading started', async () => {
  const server = await createServer({ server: { middlewareMode: true, ws: false, watch: null }, appType: 'custom' });
  try {
    const { createRefreshController } = await server.ssrLoadModule('/src/lib/app/refresh-controller.ts');
    const session = { id: 'b1', workspaceId: 'b', updatedAt: '2026-01-01T00:00:00Z' };
    let selected = null, map = { b: [session] }, loading = [], release;
    const controller = createRefreshController({
      api: { listSessions: () => new Promise(resolve => { release = resolve; }) },
      getWorkspaceSessions: id => map[id] ?? [],
      getWorkspaceSessionMap: () => map,
      getSelectedSessionId: () => selected,
      getSelectedWorkspaceId: () => 'b',
      getSessionsLoadingWorkspaceIds: () => loading,
      getSessionSearch: () => '',
      getSessionFilter: () => 'all',
      getRestoringSelection: () => false,
      getPersistedSelection: () => null,
      setWorkspaceSessionMap: value => { map = value; },
      setSessionsLoadingWorkspaceIds: value => { loading = value; },
      clearSelectedSessionContext: () => { selected = null; },
      setErrorMessage: error => assert.fail(error),
    });
    const pending = controller.refreshSessions('b');
    selected = 'b1';
    release([session]);
    await pending;
    assert.equal(selected, 'b1');
    assert.equal(map.b[0].updatedAt, session.updatedAt);
    assert.deepEqual(loading, []);
  } finally { await server.close(); }
});
