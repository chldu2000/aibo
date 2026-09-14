import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const task = (workspaceId, id, status = 'running') => ({ workspaceId, id, actionId: id, actionName: id, status, startedAt: '2026-09-12T00:00:00Z', completedAt: null, output: '' });
const git = (workspaceId, id, callerWindow = 'main') => ({ ...task(workspaceId, id), callerWindow, operation: 'git.commit', snapshot: { input: { message: 'commit' } }, result: null });

test('host execution history ignores old reads and old cancellation completions across workspace switches', async () => {
  const server = await createServer({ server: { middlewareMode: true, ws: false, watch: null }, appType: 'custom' });
  let controller;
  try {
    const { createExecutionHistoryController } = await server.ssrLoadModule('/src/lib/app/execution-history-controller.ts');
    const reads = [], stops = [], states = [];
    controller = createExecutionHistoryController({
      readTasks: workspaceId => { const result = deferred(); reads.push({ workspaceId, kind: 'task', ...result }); return result.promise; },
      readWrites: workspaceId => { const result = deferred(); reads.push({ workspaceId, kind: 'git', ...result }); return result.promise; },
      cancelTask: (workspaceId, id) => { const result = deferred(); stops.push({ workspaceId, id, ...result }); return result.promise; },
      cancelWrite: async () => { throw Error('unexpected Git stop'); }, publish: state => states.push(state),
    }, 60000);
    controller.open('old', 'main'); const old = controller.refresh();
    controller.open('new', 'main'); const current = controller.refresh();
    assert.equal(reads.length, 4); assert.equal(controller.refresh(), current);
    reads[2].resolve([task('new', 'new-task')]); reads[3].resolve([]); await current;
    reads[0].resolve([task('old', 'old-task')]); reads[1].reject(Error('old error')); await old;
    assert.deepEqual(states.at(-1).entries.map(entry => entry.id), ['new-task']); assert.deepEqual(states.at(-1).errors, []);
    const pendingStop = controller.stop('task:new-task'); await controller.stop('task:new-task'); assert.equal(stops.length, 1);
    controller.open('third', 'main'); const third = controller.refresh(); reads[4].resolve([]); reads[5].resolve([]); await third;
    const before = states.length; stops[0].resolve(true); await pendingStop;
    assert.equal(states.length, before); assert.deepEqual(stops.map(({workspaceId, id}) => ({workspaceId, id})), [{workspaceId:'new', id:'new-task'}]);
    controller.close(); assert.equal(stops.length, 1, 'closing history must not cancel any execution');
  } finally { controller?.close(); await server.close(); }
});

test('partial history failures stay visible and Git stops require the originating window', async () => {
  const server = await createServer({ server: { middlewareMode: true, ws: false, watch: null }, appType: 'custom' });
  let controller;
  try {
    const { createExecutionHistoryController, executionStatus } = await server.ssrLoadModule('/src/lib/app/execution-history-controller.ts');
    let state, failTasks = true; const calls = [];
    controller = createExecutionHistoryController({
      readTasks: async () => { if (failTasks) throw Error('offline'); return [task('w', 'task', 'outcome_unknown')]; },
      readWrites: async () => [git('w', 'own'), git('w', 'other', 'another-window')],
      cancelTask: async () => { throw Error('terminal task should not be stopped'); },
      cancelWrite: async (...args) => { calls.push(args); return true; }, publish: next => state = next,
    }, 60000);
    controller.open('w', 'main'); await controller.refresh();
    assert.equal(state.entries.length, 2); assert.match(state.errors[0], /offline/);
    await controller.stop('git:other'); assert.equal(calls.length, 0);
    await controller.stop('git:own'); await controller.stop('git:own'); assert.deepEqual(calls, [['w','own']]);
    assert.equal(executionStatus(state.entries.find(entry => entry.id === 'own')), '已请求停止');
    failTasks = false; await controller.refresh(); assert.deepEqual(state.errors, []);
    assert.match(executionStatus(state.entries.find(entry => entry.id === 'task')), /结果未知/);
    await controller.stop('task:task');
  } finally { controller?.close(); await server.close(); }
});

test('merged history pages use one stable source-aware cursor and return to newly inserted head records', async () => {
  const server = await createServer({ server: { middlewareMode: true, ws: false, watch: null }, appType: 'custom' });
  let controller;
  try {
    const { createExecutionHistoryController } = await server.ssrLoadModule('/src/lib/app/execution-history-controller.ts');
    const tasks = Array.from({length:21}, (_, index) => task('w', `same-${String(index).padStart(3,'0')}`, 'completed'));
    const writes = Array.from({length:21}, (_, index) => ({...git('w', `same-${String(index).padStart(3,'0')}`), status:'completed'}));
    const requests = []; let state, fail = false;
    function read(kind, rows, before) {
      requests.push({kind,before});
      if (fail && kind === 'git') return Promise.reject(Error('read failed'));
      return Promise.resolve(rows.filter(row => !before || row.startedAt < before.startedAt || row.startedAt === before.startedAt && (kind < before.kind || kind === before.kind && row.id < before.id))
        .sort((a,b) => a.startedAt === b.startedAt ? b.id.localeCompare(a.id) : b.startedAt.localeCompare(a.startedAt)).slice(0,21));
    }
    controller = createExecutionHistoryController({ readTasks: (_id,before) => read('task',tasks,before), readWrites: (_id,before) => read('git',writes,before), cancelTask: async()=>false, cancelWrite:async()=>false, publish: next=>state=next },60000);
    controller.open('w','main'); await controller.refresh();
    assert.equal(state.page,1); assert.equal(state.entries.length,20); assert.equal(state.hasOlder,true);
    const seen = new Set(state.entries.map(entry=>entry.key));
    tasks.push({...task('w','new-head','completed'), startedAt:'2027-01-01T00:00:00Z'});
    await controller.older(); assert.equal(state.page,2); assert.equal(state.hasNewer,true);
    assert.equal(requests.at(-1).before.kind,'task'); assert.equal(requests.at(-1).before.workspaceId,'w');
    for (const entry of state.entries) { assert(!seen.has(entry.key)); seen.add(entry.key); }
    await controller.older(); assert.equal(state.page,3); assert.equal(state.hasOlder,false);
    for (const entry of state.entries) { assert(!seen.has(entry.key)); seen.add(entry.key); }
    assert.equal(seen.size,42);
    await controller.newer(); assert.equal(state.page,2);
    await controller.latest(); assert.equal(state.page,1); assert.equal(state.entries[0].id,'new-head');
    fail=true; await controller.refresh(); assert.equal(state.hasOlder,false,'partial reads cannot advance past missing source records');
    await controller.older(); assert.equal(state.page,1);
  } finally { controller?.close(); await server.close(); }
});
