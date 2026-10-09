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

test('task output translates only explicit UTF-8 host ranges and public projection keeps command text literal', async () => {
  const server=await createServer({server:{middlewareMode:true,ws:false,watch:null},appType:'custom'});
  try {
    const {projectTaskOutput,projectTaskPresentation}=await server.ssrLoadModule('/src/lib/app/project-task-presentation.ts');
    const prefix='命令原文 😀 /{output}\nHost restarted before execution settled; inspect effects before retrying.';
    const suffix='\nHost restarted before execution settled; inspect effects before retrying.';
    const raw=prefix+suffix;
    const metadata={schema:'aibo.project-output-display/v1',segments:[{start:Buffer.byteLength(prefix),end:Buffer.byteLength(raw),raw:suffix,message:{schema:'aibo.host-message/v1',key:'native.project.outputRestartExecution',params:{}}}]};
    const run={id:'原ID /{id}',actionName:'原任务 /{name}',workspaceId:'w',sessionId:'s',status:'outcome_unknown',output:raw,localizedOutput:metadata};
    const before=structuredClone(run);
    assert.equal(projectTaskOutput(raw,undefined,'zh-CN'),raw);
    assert.equal(projectTaskOutput(raw,metadata,'en'),raw);
    const expected=prefix+'\n宿主在执行结算前重启，请检查实际影响后再重试。';
    assert.equal(projectTaskOutput(raw,metadata,'zh-CN'),expected);
    const projected=projectTaskPresentation(run,'zh-CN');
    assert.equal(projected.output,expected);assert.equal(projected.id,run.id);assert.equal(projected.actionName,run.actionName);
    assert.equal(Object.hasOwn(projected,'localizedOutput'),false);assert.equal(JSON.stringify(projected).includes('aibo.host-message/v1'),false);
    assert.deepEqual(run,before);
    const bomRaw='\ufeff'+raw+'\ufeff末尾原文';
    const bomMetadata={...metadata,segments:metadata.segments.map(segment=>({...segment,start:segment.start+3,end:segment.end+3}))};
    assert.equal(projectTaskOutput(bomRaw,bomMetadata,'zh-CN'),'\ufeff'+expected+'\ufeff末尾原文');
    const surrogateRaw='\ud800'+raw;
    assert.equal(projectTaskOutput(surrogateRaw,bomMetadata,'zh-CN'),surrogateRaw);
    const unknown={...metadata,segments:[{...metadata.segments[0],message:{schema:'aibo.host-message/v1',key:'native.project.futureOutput',params:{}}}]};
    for(const invalid of [null,{}, {...metadata,schema:'invalid'},unknown,
      {...metadata,segments:[{...metadata.segments[0],raw:'wrong'}]},
      {...metadata,segments:[{...metadata.segments[0],start:1}]},
      {...metadata,segments:[{...metadata.segments[0],start:0,end:1,raw:''}]},
      {...metadata,segments:[{...metadata.segments[0],end:Buffer.byteLength(raw)+1}]},
      {...metadata,segments:[metadata.segments[0],metadata.segments[0]]},
      {...metadata,segments:[{...metadata.segments[0],start:-1}]},
      {...metadata,segments:[{...metadata.segments[0],start:0.5}]},
      {...metadata,segments:[{...metadata.segments[0],message:{schema:'invalid',key:'native.project.outputRestartExecution',params:{}}}]},
      {...metadata,segments:[{...metadata.segments[0],message:{schema:'aibo.host-message/v1',key:'native.session.archived',params:{}}}]},
    ]) assert.equal(projectTaskOutput(raw,invalid,'zh-CN'),raw);
    assert.equal(projectTaskOutput('changed '+raw,metadata,'zh-CN'),'changed '+raw);
    const brokenUnicode={schema:'aibo.project-output-display/v1',segments:[{start:1,end:3,raw:'文',message:metadata.segments[0].message}]};
    assert.equal(projectTaskOutput('原文',brokenUnicode,'en'),'原文');
  }finally{await server.close();}
});

test('execution history retains task output metadata for deferred language rendering and leaves Git result JSON unchanged', async () => {
  const server=await createServer({server:{middlewareMode:true,ws:false,watch:null},appType:'custom'});let controller;
  try{
    const {createExecutionHistoryController,executionOutput}=await server.ssrLoadModule('/src/lib/app/execution-history-controller.ts');
    const raw='Host restarted during approval; task was not started.';
    const metadata={schema:'aibo.project-output-display/v1',segments:[{start:0,end:Buffer.byteLength(raw),raw,message:{schema:'aibo.host-message/v1',key:'native.project.outputRestartApproval',params:{}}}]};
    const run={id:'task',workspaceId:'w',actionId:'action',actionName:'原文 /{name}',status:'rejected',output:raw,localizedOutput:metadata,startedAt:'now',completedAt:'now'};
    const git={id:'git',workspaceId:'w',operation:'git.commit',status:'failed',snapshot:{input:{}},result:{ok:false,error:{code:'provider',message:raw}},startedAt:'now',completedAt:'now'};
    let reads=0,state;
    controller=createExecutionHistoryController({readTasks:async()=>{reads++;return [run]},readWrites:async()=>{reads++;return [git]},cancelTask:async()=>false,cancelWrite:async()=>false,publish:value=>state=value},60000);
    controller.open('w','main');await controller.refresh();const before=structuredClone(state);
    const taskEntry=state.entries.find(entry=>entry.kind==='task');const gitEntry=state.entries.find(entry=>entry.kind==='git');
    assert.equal(executionOutput(taskEntry,'zh-CN'),'宿主在审批期间重启，任务未启动。');
    assert.equal(executionOutput(taskEntry,'en'),raw);
    assert.equal(executionOutput(gitEntry,'zh-CN'),JSON.stringify(git.result,null,2));
    assert.equal(executionOutput({...gitEntry,localizedOutput:metadata},'en'),gitEntry.output);
    assert.equal(reads,2);assert.deepEqual(state,before);assert.equal(run.output,raw);
  }finally{controller?.close();await server.close();}
});
