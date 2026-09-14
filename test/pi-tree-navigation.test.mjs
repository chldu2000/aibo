import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

test('Pi navigation reloads the active timeline and ignores results for another selected session', async () => {
  const server = await createServer({ server: { middlewareMode: true, ws: false, watch: null }, appType: 'custom' });
  try {
    const { createPiTreeController } = await server.ssrLoadModule('/src/lib/app/pi-tree-controller.ts');
    let selected = 'pi-session';
    let pending = 'branch-b';
    let timeline = [{ id: 'branch-a' }];
    let tree = { leafId: 'branch-a' };
    let release;
    const context = {
      api: {
        invokeAgentCapability: async (id, capability, input) => {
          assert.equal(id, 'pi-session');
          assert.equal(capability, 'session.tree');
          assert.equal(input.entryId, 'branch-b');
          return { leafId: 'branch-b', tree: [], cancelled: false };
        },
        getTimeline: async () => [{ id: 'branch-b' }],
      },
      getDesktop: () => true,
      getSelectedSession: () => ({ id: 'pi-session', agent: 'dev.aibo.pi.agent', capabilities: ['session.tree'], pluginInstallationId: 'pi' }),
      getSelectedSessionId: () => selected,
      getPendingEntryId: () => pending,
      setPendingEntryId: (value) => { pending = value; },
      setPiTree: (value) => { tree = value; },
      setTimeline: (value) => { timeline = value; },
      setComposerText() {}, setBusy() {}, setNotice() {},
      setErrorMessage(error) { assert.equal(error, null); },
    };
    const controller = createPiTreeController(context);
    assert.equal(await controller.confirmNavigation({ mode: 'none' }), true);
    assert.equal(tree.leafId, 'branch-b');
    assert.deepEqual(timeline, [{ id: 'branch-b' }]);

    pending = 'branch-b';
    let started;
    const timelineStarted = new Promise((resolve) => { started = resolve; });
    context.api.getTimeline = () => new Promise((resolve) => { release = resolve; started(); });
    const navigation = controller.confirmNavigation({ mode: 'none' });
    await timelineStarted;
    assert.ok(release);
    selected = 'other-session';
    timeline = [{ id: 'other-session-message' }];
    release([{ id: 'branch-b' }]);
    assert.equal(await navigation, false);
    assert.deepEqual(timeline, [{ id: 'other-session-message' }]);
  } finally {
    await server.close();
  }
});
