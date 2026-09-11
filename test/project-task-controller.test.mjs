import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

test('task submissions share pending work but keep workspace/session identity and allow intentional reruns', async () => {
  const server = await createServer({ server: { middlewareMode: true, ws: false, watch: null }, appType: 'custom' });
  try {
    const { createProjectTaskController } = await server.ssrLoadModule('/src/lib/app/project-task-controller.ts');
    const calls = [];
    let sequence = 0;
    const controller = createProjectTaskController({
      requestId: () => `request-${++sequence}`,
      execute: (...args) => new Promise((resolve, reject) => calls.push({ args, resolve, reject })),
    });
    const first = controller.run('workspace', 'task', null);
    assert.equal(controller.run('workspace', 'task', null), first);
    const otherWorkspace = controller.run('other', 'task', null);
    const otherSession = controller.run('workspace', 'task', 'session');
    await Promise.resolve();
    assert.equal(calls.length, 3);
    assert.equal(new Set(calls.map(call => call.args[3])).size, 3);
    calls[0].resolve({ id: 'run', status: 'completed' });
    assert.equal((await first).id, 'run');
    const rerun = controller.run('workspace', 'task', null);
    await Promise.resolve();
    assert.notEqual(calls[3].args[3], calls[0].args[3]);
    const failure = assert.rejects(rerun, /disconnected/);
    calls[3].reject(new Error('disconnected'));
    await failure;
    assert.equal(calls.length, 4, 'failure must not automatically resubmit');
    calls[1].resolve({}); calls[2].resolve({});
    await Promise.all([otherWorkspace, otherSession]);
  } finally { await server.close(); }
});
