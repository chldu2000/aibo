import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

test('late send completion consumes only the submitted session draft', async () => {
  const server = await createServer({ server: { middlewareMode: true, ws: false, watch: null }, appType: 'custom' });
  try {
    const { createMessageController } = await server.ssrLoadModule('/src/lib/app/message-controller.ts');
    const original = { id: 'original', workspaceId: 'workspace', capabilities: [], archived: false };
    let selected = original, composer = 'original draft', finish, started;
    const entered = new Promise(resolve => { started = resolve; });
    const consumed = [];
    const controller = createMessageController({
      api: {
        validateSessionAttachments: async () => [],
        sendAgentPrompt: async (id, input) => {
          assert.equal(id, original.id); assert.equal(input, 'original draft'); started();
          return new Promise(resolve => { finish = resolve; });
        },
      },
      getDesktop: () => true, getSelectedWorkspace: () => ({ id: 'workspace' }),
      getSelectedSession: () => selected, getSelectedSessionArchiving: () => false,
      getComposerText: () => composer, setComposerText: () => assert.fail('send cannot clear the current editor without checking ownership'),
      consumeDraft: (id, text) => { consumed.push([id, text]); },
      getAttachments: () => [], getWorkspaceSessionMap: () => ({ workspace: [original] }),
      setWorkspaceSessionMap() {}, setBusy() {}, setErrorMessage(error) { assert.equal(error, null); },
      setLastSubmittedPrompt() {}, setPromptInFlight() {}, updateWorkspaceSessions() {},
      refreshTimeline: async () => {}, refreshAttachments: async () => {},
    });
    const pending = controller.sendPrompt(); await entered;
    selected = { ...original, id: 'other' }; composer = 'new draft';
    finish({ ...original, state: 'running' }); await pending;
    assert.deepEqual(consumed, [['original', 'original draft']]);
    assert.equal(composer, 'new draft');
  } finally { await server.close(); }
});

test('accepted sends and queued messages stay accepted when the following refresh fails', async () => {
  const server = await createServer({ server: { middlewareMode: true, ws: false, watch: null }, appType: 'custom' });
  try {
    const { createMessageController } = await server.ssrLoadModule('/src/lib/app/message-controller.ts');
    for (const queue of [false, true]) {
      const session = { id: 'session', workspaceId: 'workspace', pluginInstallationId: 'plugin', capabilities: ['queue.manage'], archived: false };
      let sends = 0, composer = 'accepted draft';
      const failed = [], errors = [], notices = [];
      const controller = createMessageController({
        api: {
          validateSessionAttachments: async () => [],
          sendAgentPrompt: async () => { sends++; return { ...session, state: 'running' }; },
          invokeAgentCapability: async () => { sends++; return {}; },
        },
        getDesktop: () => true, getSelectedWorkspace: () => ({ id: 'workspace' }),
        getSelectedSession: () => session, getSelectedSessionArchiving: () => false,
        getComposerText: () => composer, consumeDraft: () => { composer = ''; },
        getAttachments: () => [], getWorkspaceSessionMap: () => ({ workspace: [session] }),
        setWorkspaceSessionMap() {}, setBusy() {}, setLastSubmittedPrompt() {}, setPromptInFlight() {}, updateWorkspaceSessions() {},
        setComposerDraftStatus: (_id, value) => failed.push(value),
        setErrorMessage: error => errors.push(error), setNotice: notice => notices.push(notice),
        refreshTimeline: async () => { throw Error('timeline temporarily unavailable'); },
        refreshAttachments: async () => {},
      });
      if (queue) await controller.queuePiPrompt('steer'); else await controller.sendPrompt();
      assert.equal(sends, 1);
      assert.equal(composer, '', 'accepted draft must be consumed despite refresh failure');
      assert.ok(!failed.includes(true), 'a refresh error cannot label the send failed');
      assert.ok(errors.every(error => error === null));
      assert.ok(notices.some(notice => notice.includes('刷新')));
    }
  } finally { await server.close(); }
});
