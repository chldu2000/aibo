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

test('history observation ignores disposed reads and keeps polling after a transient read error', async () => {
  const server = await createServer({ server: { middlewareMode: true, ws: false, watch: null }, appType: 'custom' });
  try {
    const { observeProjectTaskHistory } = await server.ssrLoadModule('/src/lib/app/project-task-controller.ts');
    let resolveOld;
    const published = [], errors = [];
    const disposeOld = observeProjectTaskHistory({
      read: () => new Promise(resolve => { resolveOld = resolve; }),
      publish: value => published.push(value), error: error => errors.push(error),
    }, 5);
    disposeOld(); resolveOld([{ id: 'old-workspace' }]);
    await Promise.resolve();
    assert.deepEqual(published, []);
    let reads = 0, finished;
    const observed = new Promise(resolve => { finished = resolve; });
    const dispose = observeProjectTaskHistory({
      read: async () => { if (++reads === 1) throw new Error('temporary'); return [{ id: 'current-workspace', status: 'running' }]; },
      publish: value => { published.push(value); finished(); }, error: error => errors.push(error),
    }, 5);
    try {
      await observed;
      assert.equal(errors.length, 1);
      assert.equal(published[0][0].id, 'current-workspace');
    } finally { dispose(); }
  } finally { await server.close(); }
});
