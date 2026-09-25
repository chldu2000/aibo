import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};

for (const operation of ['forkSession', 'unarchiveSession']) {
  test(`${operation} shares navigation cleanup and ignores late reads after another selection`, async () => {
    const server = await createServer({ server: { middlewareMode: true, ws: false, watch: null }, appType: 'custom' });
    try {
      const { createSessionLifecycleController } = await server.ssrLoadModule('/src/lib/app/session-lifecycle-controller.ts');
      const { createNavigationController } = await server.ssrLoadModule('/src/lib/app/navigation-controller.ts');
      const { createSessionContextController } = await server.ssrLoadModule('/src/lib/app/session-context-controller.ts');
      const target = { id: 'source', workspaceId: 'w', archived: operation === 'unarchiveSession', capabilities: ['session.fork'], state: 'idle' };
      const result = { ...target, id: operation === 'forkSession' ? 'forked' : target.id, archived: false };
      const native = deferred(), reading = deferred(), refresh = deferred();
      let selected = 'other', workspace = 'w', map = { w: [target, { ...target, id: 'other', archived: false }, { ...target, id: 'b', archived: false }] };
      let timeline = ['old'], profile = 'old', attachments = ['old'];
      const reads = [];
      const context = {
        api: { forkCodexThread: () => native.promise, unarchiveSession: () => native.promise,
          getTimeline: id => id === result.id ? reading.promise : Promise.resolve([id]) },
        getDesktop: () => true, getSelectedSessionId: () => selected, getSelectedWorkspaceId: () => workspace,
        getArchivingSessionId: () => null, getExpandedWorkspaceIds: () => ['w'],
        findSession: id => Object.values(map).flat().find(session => session.id === id),
        getWorkspaceSessionMap: () => map, getWorkspaceSessions: id => map[id] ?? [],
        setWorkspaceSessionMap: value => { map = value; }, setSelectedSessionId: value => { selected = value; },
        setSelectedWorkspaceId: value => { workspace = value; }, setTimeline: value => { timeline = value; },
        clearSelectedSessionContext: () => { selected = null; timeline = []; profile = null; attachments = []; },
        refreshSessions: () => refresh.promise, isSessionRunning: () => false,
      };
      for (const name of ['setBusy', 'setNotice', 'setTimelineVisibleCount', 'setExpandedWorkspaceIds', 'setCodexThreadSnapshot',
        'refreshCodexThread', 'refreshCodexThreads', 'refreshPiTree', 'refreshExecutionProfile', 'refreshTurnChangeSet', 'refreshAttachments', 'refreshArtifacts']) context[name] = () => {};
      context.setErrorMessage = error => { if (error) assert.fail(error); };
      const sessionContext = createSessionContextController(context);
      context.refreshTimeline = id => { const read = sessionContext.refreshTimeline(id); reads.push(read); return read; };
      const navigation = createNavigationController(context);
      context.activateWorkspace = navigation.activateWorkspace;
      context.selectSession = navigation.selectSession;
      const lifecycle = createSessionLifecycleController(context);
      const pending = lifecycle[operation](target.id);
      native.resolve(result);
      await Promise.resolve(); await Promise.resolve();
      assert.equal(selected, result.id);
      assert.equal(profile, null, 'switching through lifecycle clears the old model profile');
      assert.deepEqual(attachments, [], 'switching through lifecycle clears old attachments');
      navigation.selectSession('b');
      reading.resolve(['stale result']); refresh.resolve();
      await pending; await Promise.all(reads);
      assert.equal(selected, 'b');
      assert.deepEqual(timeline, ['b']);
      assert.ok(map.w.some(session => session.id === result.id && !session.archived));
    } finally { await server.close(); }
  });

  test(`${operation} keeps its result without taking selection back after native completion`, async () => {
    const server = await createServer({ server: { middlewareMode: true, ws: false, watch: null }, appType: 'custom' });
    try {
      const { createSessionLifecycleController } = await server.ssrLoadModule('/src/lib/app/session-lifecycle-controller.ts');
      const native = deferred();
      const target = { id: 'source', workspaceId: 'w', archived: operation === 'unarchiveSession', capabilities: ['session.fork'] };
      let selected = 'source', workspace = 'w', map = { w: [target] };
      const controller = createSessionLifecycleController({
        api: { forkCodexThread: () => native.promise, unarchiveSession: () => native.promise },
        getDesktop: () => true, findSession: () => target, getArchivingSessionId: () => null,
        getSelectedSessionId: () => selected, getSelectedWorkspaceId: () => workspace,
        getWorkspaceSessionMap: () => map, setWorkspaceSessionMap: value => { map = value; },
        selectSession: () => assert.fail('late operation must not navigate'),
        isSessionRunning: () => false, setBusy() {}, setNotice() {}, refreshCodexThreads() {}, refreshSessions: async () => {},
        setErrorMessage(error) { if (error) assert.fail(error); },
      });
      const pending = controller[operation](target.id);
      selected = 'b'; workspace = 'other';
      native.resolve({ ...target, id: 'result', archived: false });
      await pending;
      assert.equal(selected, 'b'); assert.equal(workspace, 'other');
      assert.ok(map.w.some(session => session.id === 'result'));
    } finally { await server.close(); }
  });
}

test('shared timeline reads report current failures and discard failures after navigation', async () => {
  const server = await createServer({ server: { middlewareMode: true, ws: false, watch: null }, appType: 'custom' });
  try {
    const { createSessionContextController } = await server.ssrLoadModule('/src/lib/app/session-context-controller.ts');
    let selected = 'a', error = null, request = deferred();
    const controller = createSessionContextController({
      api: { getTimeline: () => request.promise }, getSelectedSessionId: () => selected,
      setErrorMessage: value => { error = value; }, setTimeline: () => assert.fail('failed read has no timeline'),
    });
    const current = controller.refreshTimeline('a'); request.reject(Error('read failed')); await current;
    assert.equal(error, 'read failed');
    error = null; request = deferred();
    const stale = controller.refreshTimeline('a'); selected = 'b'; request.reject(Error('stale failure')); await stale;
    assert.equal(error, null);
  } finally { await server.close(); }
});
