import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
import { sessionAgentKind, sessionModelBackend } from '../src/lib/app/agent-kind.ts';
import { createAgentFacade } from '../src/lib/app/agent-facade.ts';

const session = {
  id: 'external-session', agent: 'dev.example.agent', pluginInstallationId: 'external-release',
  capabilities: ['queue.manage', 'session.tree', 'permissions.nativeSandbox', 'command.list'],
};

test('queue, tree and sandbox capabilities do not identify Pi or Codex', () => {
  assert.equal(sessionAgentKind(session), 'plugin');
  assert.equal(sessionModelBackend(session), 'plugin');
});

test('capability facade uses the bound plugin and never falls through to legacy transport', async () => {
  const calls = [];
  const facade = createAgentFacade({
    invokeAgentCapability: async (...args) => { calls.push(args); return { ok: true }; },
    legacyCapability: async () => { assert.fail('must not enter legacy transport'); },
  });
  for (const [capability, input] of [['queue.manage', { action: 'clear' }], ['session.tree', { action: 'get' }]]) {
    await facade.invoke(session, capability, input);
    assert.deepEqual(calls.at(-1), [session.id, capability, input]);
  }
  await assert.rejects(facade.invoke(session, 'model.select'), /capability_unsupported/);
  assert.equal(calls.length, 2);
  const unavailable = createAgentFacade({ invokeAgentCapability: async () => { throw new Error('provider_unavailable'); },
    legacyCapability: async () => assert.fail('failed plugins must not fall back') });
  await assert.rejects(unavailable.invoke(session, 'session.tree'), /provider_unavailable/);
});

test('non-Pi tree navigation uses the same production controller and rejects unbound impostors', async () => {
  const server = await createServer({ server: { middlewareMode: true, ws: false, watch: null }, appType: 'custom' });
  try {
    const { createPiTreeController } = await server.ssrLoadModule('/src/lib/app/pi-tree-controller.ts');
    let selected = session;
    let pending = 'branch-b';
    let result;
    let error;
    const controller = createPiTreeController({
      api: {
        invokeAgentCapability: async (id, capability, input) => {
          assert.equal(id, session.id); assert.equal(capability, 'session.tree');
          assert.equal(input.entryId, 'branch-b');
          return { leafId: 'branch-b', tree: [], cancelled: false };
        },
        navigatePiSessionTree: () => assert.fail('must not route external sessions to Pi'),
        getTimeline: async () => [],
      },
      getSelectedSession: () => selected, getSelectedSessionId: () => selected.id,
      getPendingEntryId: () => pending, setPendingEntryId: (value) => { pending = value; },
      getDesktop: () => true, setBusy() {}, setNotice() {}, setComposerText() {}, setTimeline() {},
      setPiTree: (value) => { result = value; }, setErrorMessage: (value) => { error = value; },
    });
    assert.equal(await controller.confirmNavigation({ mode: 'none' }), true);
    assert.equal(result.leafId, 'branch-b');
    selected = { ...session, pluginInstallationId: null }; pending = 'branch-b';
    assert.equal(await controller.confirmNavigation({ mode: 'none' }), false);
    assert.match(error, /provider_unavailable/);
  } finally { await server.close(); }
});
