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

test('host approvals reject stale cards and duplicate submissions without discarding replacement requests', async () => {
  const server = await createServer({ server: { middlewareMode: true, ws: false, watch: null }, appType: 'custom' });
  try {
    const { createApprovalController } = await server.ssrLoadModule('/src/lib/app/approval-controller.ts');
    const approval = { sessionId: 's', requestId: 'r', turnId: 't', kind: 'command', command: 'pwd', cwd: '/w', availableDecisions: ['accept', 'cancel'] };
    let pending = [approval], finish;
    const calls = [];
    const controller = createApprovalController({
      api: { resolveAgentApproval: async (...args) => { calls.push(args); await new Promise(resolve => { finish = resolve; }); } },
      getDesktop: () => true, getPendingApprovals: () => pending,
      setPendingApprovals: value => { pending = value; },
      setBusy() {}, setErrorMessage() {}, setNotice() {},
    });
    await controller.resolveApproval({...approval, command: 'different'}, 'accept');
    assert.equal(calls.length, 0);
    const first = controller.resolveApproval(approval, 'accept');
    await controller.resolveApproval(approval, 'cancel');
    assert.equal(calls.length, 1, 'a second decision cannot race the admitted one');
    const replacement = {...approval, turnId: 'next'};
    pending = [replacement];
    finish(); await first;
    assert.deepEqual(pending, [replacement], 'late response must preserve a replacement request');
    await controller.resolveApproval(approval, 'accept');
    assert.equal(calls.length, 1);
    pending = [];
    await controller.resolveApproval(replacement, 'accept');
    assert.equal(calls.length, 1, 'removed approval cannot be replayed');
  } finally { await server.close(); }
});
