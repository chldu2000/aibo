import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

test('Git clicks share pending request identity, separate scopes, and never retry errors automatically', async () => {
  const server = await createServer({ server: { middlewareMode: true, ws: false, watch: null }, appType: 'custom' });
  try {
    const { createWorkspaceWriteController } = await server.ssrLoadModule('/src/lib/app/workspace-write-controller.ts');
    const calls = []; let sequence = 0;
    const writes = createWorkspaceWriteController({ requestId: () => `request-${++sequence}`, execute: (command, input, id) => new Promise((resolve, reject) => calls.push({ command, input, id, resolve, reject })) });
    const input = { workspaceId: 'a', action: 'stage_all' };
    const first = writes.invoke('apply_workspace_git_action', input);
    assert.equal(writes.invoke('apply_workspace_git_action', { ...input }), first);
    const other = writes.invoke('apply_workspace_git_action', { ...input, workspaceId: 'b' });
    const explicit = writes.invoke('apply_workspace_git_action', input, 'intentional-request');
    await Promise.resolve(); assert.equal(calls.length, 3);
    assert.equal(calls[2].id, 'intentional-request');
    calls[0].resolve({ applied: true }); await first;
    const next = writes.invoke('apply_workspace_git_action', input);
    await Promise.resolve(); assert.notEqual(calls[3].id, calls[0].id);
    const failed = assert.rejects(next, /unknown/); calls[3].reject(new Error('outcome unknown')); await failed;
    assert.equal(calls.length, 4);
    calls[1].resolve({}); calls[2].resolve({}); await Promise.all([other, explicit]);
  } finally { await server.close(); }
});
