import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

test('approval controller routes any agent and kind through the host and preserves other requests', async () => {
  const server = await createServer({ server: { middlewareMode: true, ws: false, watch: null }, appType: 'custom' });
  try {
    const { createApprovalController } = await server.ssrLoadModule('/src/lib/app/approval-controller.ts');
    const approval = { sessionId: 'external', requestId: 'same-id', kind: 'pi_command', availableDecisions: ['accept', 'cancel'] };
    const other = { ...approval, sessionId: 'other' };
    let pending = [approval, other], fail = true;
    const calls = [], errors = [];
    const controller = createApprovalController({
      api: { resolveAgentApproval: async (...args) => { calls.push(args); if (fail) throw new Error('pending'); } },
      getDesktop: () => true, getPendingApprovals: () => pending,
      setPendingApprovals: value => { pending = value; },
      setBusy() {}, setErrorMessage: value => errors.push(value), setNotice() {},
    });
    await controller.resolveApproval(approval, 'accept');
    assert.deepEqual(pending, [approval, other]);
    assert.equal(errors.at(-1), 'pending');
    fail = false;
    await controller.resolveApproval(approval, 'accept');
    assert.deepEqual(calls, [['external', 'same-id', 'accept'], ['external', 'same-id', 'accept']]);
    assert.deepEqual(pending, [other]);
  } finally { await server.close(); }
});
