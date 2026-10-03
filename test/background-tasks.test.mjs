import test from 'node:test';
import assert from 'node:assert/strict';
import { BackgroundTasks } from '../packages/acp-adapter/background-tasks.mjs';
import '../packages/plugin-host/register.mjs';
const { CodexBackgroundTasks } = await import('../src-tauri/capability-plugins/codex/background-tasks.mjs');
import { parseBackgroundTask } from '../packages/presentation-workbench/background-tasks.js';
import { renderTimelineEntry } from '../packages/presentation-workbench/timeline.js';

test('background state survives idle, terminal-before-progress, and recovery without claiming liveness', () => {
  const tasks = new BackgroundTasks();
  tasks.update({id:'shell',name:'eval',command:'python eval.py'},'parent');
  tasks.update({id:'shell',status:'completed',exitCode:0});
  tasks.update({id:'shell',status:'running'},'other-turn');
  assert.equal(tasks.list()[0].status,'completed');
  assert.equal(tasks.list()[0].rootTurnId,'parent');
  tasks.update({id:'server'},'parent');
  const restored = new BackgroundTasks(); restored.restore(tasks.list());
  assert.equal(restored.tasks.get('shell').status,'completed');
  assert.equal(restored.tasks.get('server').status,'unknown');
  restored.update({id:'unowned'});
  assert.equal(restored.tasks.has('unowned'),false);
});

test('Codex requires background evidence, preserves parent and receives completion after parent ends', async () => {
  const tasks = new CodexBackgroundTasks();
  const item = {id:'cmd',type:'commandExecution',command:'sleep 10',processId:'42',status:'inProgress'};
  tasks.observe('item/started',{item},'parent');
  assert.equal(tasks.list().length,0,'a foreground PTY is not automatically a background task');
  tasks.turnEnded('parent');
  assert.equal(tasks.list()[0].status,'running');
  const calls=[];
  await tasks.refresh(async method => {
    calls.push(method);
    if (method.endsWith('/list')) throw Error('Unknown method');
    return {thread:{turns:[{items:[{...item,status:'failed',exitCode:2,aggregatedOutput:'test failed'}]}]}};
  },'native');
  assert.equal(tasks.list()[0].status,'failed');
  assert.equal(tasks.list()[0].exitCode,2);
  assert.deepEqual(calls,['thread/backgroundTerminals/list','thread/read']);
  tasks.observe('item/completed',{item:{...item,status:'completed',exitCode:0}},null);
  assert.equal(tasks.list()[0].rootTurnId,'parent');
});

test('native terminal list discovers background work during a turn; missing tasks are not successes', async () => {
  const tasks = new CodexBackgroundTasks();
  const item={id:'cmd',type:'commandExecution',command:'server',status:'inProgress'};
  tasks.observe('item/started',{item},'t');
  await tasks.refresh(async method => method.endsWith('/list') ? {data:[{itemId:'cmd'}]} : {thread:{turns:[]}},'n');
  assert.equal(tasks.list()[0].status,'running');
  tasks.unavailable('lost');
  await tasks.refresh(async method => method.endsWith('/list') ? {data:[]} : {thread:{turns:[{items:[item]}]}},'n');
  assert.equal(tasks.list()[0].status,'unknown','historical inProgress is not a live process check');
});

test('background task presentation uses literal commands and honest recovered state', () => {
  const tasks=new BackgroundTasks();tasks.update({id:'x',command:'<script>alert(1)</script>'},'t');
  const item={id:'m',toolName:'background_task',content:JSON.stringify(tasks.list()[0]),status:'interrupted'};
  assert.equal(parseBackgroundTask(item).status,'unknown');
  const tree=renderTimelineEntry(item,[]);
  assert.match(JSON.stringify(tree),/状态未知/);
  assert.match(JSON.stringify(tree),/后台任务/);
  assert.equal(tree.children.some(child=>child?.tag==='pre'),true);
});


test('packaged Codex worker exposes a background process after its parent turn finishes', async t => {
  const {sessionCapability}=await import('./helpers/session-capability.mjs');
  const f=await sessionCapability(t,'codex');
  await f.invoke('aibo.session.open',{mode:'create',executionProfile:{interactionMode:'ask',filesystemPolicy:'read-only',commandPolicy:'disabled',networkPolicy:'disabled',approvalPolicy:'on-request',approvalReviewer:'user'}});
  await f.invoke('aibo.session.turn',{text:'background please'},'parent');
  const read=()=>f.invoke('dev.aibo.codex.background-tasks.list');
  const initial=await read();
  assert.equal(initial.tasks[0].status,'running');
  assert.equal(initial.tasks[0].rootTurnId,'parent');
  let final=initial;
  for(let i=0;i<30 && final.tasks[0].status==='running';i++) {
    await new Promise(resolve=>setTimeout(resolve,50)); final=await read();
  }
  assert.equal(final.tasks[0].status,'completed');
  assert.equal(final.tasks[0].exitCode,0);
  assert.ok(!f.events.some(frame=>frame.event.type.startsWith('subagent.')));
});

test('background observation serializes reads and ignores failures after disposal', async () => {
  const {createServer}=await import('vite');
  const server=await createServer({server:{middlewareMode:true,ws:false,watch:null},appType:'custom'});
  try {
    const {watchBackgroundTasks}=await server.ssrLoadModule('/src/lib/app/background-task-controller.ts');
    const callbacks=[]; let reject, calls=0, failures=0;
    const stop=watchBackgroundTasks({capabilities:['background-tasks.list']},{
      invoke:()=>{calls++;return new Promise((_,fail)=>{reject=fail;});}, failed:()=>failures++,
      schedule:callback=>(callbacks.push(callback),callbacks.length),clear:()=>{},
    });
    callbacks.shift()();
    assert.equal(calls,1);assert.equal(callbacks.length,0,'do not schedule an overlapping read');
    stop();reject(Error('disconnected'));await new Promise(resolve=>setImmediate(resolve));
    assert.equal(failures,0);assert.equal(callbacks.length,0);
    const hidden=watchBackgroundTasks({capabilities:[]},{invoke:async()=>calls++,failed:()=>failures++,schedule:callback=>(callbacks.push(callback),1)});
    hidden();assert.equal(callbacks.length,0);
  } finally {await server.close();}
});
