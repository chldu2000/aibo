import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RecoveryStateStore } from '../packages/acp-adapter/recovery-state.mjs';
import { BackgroundTasks } from '../packages/acp-adapter/background-tasks.mjs';
function root(t) { const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aibo-recovery-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir; }
test('legacy oversized background state migrates to constant size immutable references', t=>{
 const dir=root(t), tasks=new BackgroundTasks(); tasks.configureStorage(dir,'session');
 const legacy=Array.from({length:40},(_,i)=>({id:`task-${i}`,rootTurnId:'turn',status:i?'completed':'running',output:'中'.repeat(12000),activity:'done'}));
 tasks.restore(legacy);const first=tasks.checkpoint();assert.ok(JSON.stringify(first).length<150);
 tasks.update({id:'task-0',status:'completed',output:'finished'});const second=tasks.checkpoint();assert.notDeepEqual(first,second);
 const restored=new BackgroundTasks();restored.configureStorage(dir,'session');restored.restore(first);
 assert.equal(restored.tasks.get('task-0').status,'unknown');assert.equal(restored.tasks.get('task-39').output,legacy[39].output);
 assert.deepEqual(tasks.checkpoint(),second,'unchanged state reuses immutable object');
 const copy=root(t);fs.cpSync(dir,copy,{recursive:true}); const store=new RecoveryStateStore(copy,'session');assert.equal(store.load(second)[0].status,'completed');
});
test('missing, corrupt, foreign and traversal references fail closed',t=>{
 const dir=root(t),store=new RecoveryStateStore(dir,'a'),ref=store.save({value:1});
 assert.throws(()=>new RecoveryStateStore(dir,'b').load(ref),{kind:'recovery_state_corrupt'});
 assert.throws(()=>store.load({...ref,digest:'../outside'}),{kind:'recovery_state_corrupt'});
 assert.throws(()=>store.load({...ref,digest:'0'.repeat(64)}),{kind:'recovery_state_missing'});
 fs.writeFileSync(path.join(dir,'recovery-state-v1',ref.digest+'.json'),'{}');assert.throws(()=>store.load(ref),{kind:'recovery_state_corrupt'});
});
test('budget failure preserves previous revisions and unreferenced committed revision is harmless',t=>{
 const dir=root(t),store=new RecoveryStateStore(dir,'a',{maxBytes:200}),ref=store.save({value:'old'});
 store.save({value:'unpublished'});assert.deepEqual(store.load(ref),{value:'old'});
 assert.throws(()=>store.save({value:'x'.repeat(300)}),{kind:'recovery_state_write_failed'});assert.deepEqual(store.load(ref),{value:'old'});
});
test('symlinks are rejected and unknown tasks are not capacity eviction candidates',t=>{
 const dir=root(t),outside=root(t);fs.symlinkSync(outside,path.join(dir,'recovery-state-v1'));
 assert.throws(()=>new RecoveryStateStore(dir,'a').save([]),{kind:'recovery_state_corrupt'});
 const tasks=new BackgroundTasks();for(let i=0;i<128;i++)tasks.update({id:String(i),status:'unknown'},'turn');
 assert.throws(()=>tasks.update({id:'overflow'},'turn'),{kind:'recovery_state_write_failed'});assert.equal(tasks.list().length,128);
});

test('task pages stay bounded and output chunks detect changes',()=>{
 const tasks=new BackgroundTasks();for(let i=0;i<128;i++)tasks.update({id:String(i).padStart(3,'0')+'中'.repeat(3990),name:'中'.repeat(4000),command:'中'.repeat(4000),activity:'中'.repeat(12000),output:'🙂'.repeat(6000),status:'completed'},'中'.repeat(4000));
 const ids=[];let cursor;do {const page=tasks.page(cursor);assert.ok(Buffer.byteLength(JSON.stringify(page))<100000);ids.push(...page.tasks.map(t=>t.id));assert.ok(page.tasks.every(t=>t.output===undefined));cursor=page.nextCursor;}while(cursor);
 assert.equal(ids.length,128);assert.equal(new Set(ids).size,128);
 const first=tasks.read({taskId:ids[0]});assert.ok(first.nextCursor);assert.equal(Array.from(first.output).length,4096);
 const last=tasks.read({taskId:ids[0],cursor:first.nextCursor,revision:first.revision});assert.equal(first.output+last.output,'🙂'.repeat(6000));
 tasks.update({id:ids[0],output:'changed'});assert.throws(()=>tasks.read({taskId:ids[0],revision:first.revision}),{kind:'busy'});
});

test('packaged Codex migrates oversized inline recovery and resumes the same thread after restart', async t=>{
 const {sessionCapability}=await import('./helpers/session-capability.mjs');
 const f=await sessionCapability(t,'codex');
 const executionProfile={interactionMode:'ask',filesystemPolicy:'read-only',commandPolicy:'disabled',networkPolicy:'disabled',approvalPolicy:'on-request',approvalReviewer:'user'};
 const opened=await f.invoke('aibo.session.open',{mode:'create',executionProfile});
 const legacy={...opened.recovery,version:1,data:{...opened.recovery.data,backgroundTasks:Array.from({length:10},(_,i)=>({id:`old-${i}`,rootTurnId:'parent',status:'completed',activity:'done',output:'中'.repeat(5000)}))}};
 assert.ok(Buffer.byteLength(JSON.stringify(legacy))>65536);
 await f.client.close();
 const resumed=await sessionCapability(t,'codex',{},f.directory);
 const second=await resumed.invoke('aibo.session.open',{mode:'resume',executionProfile,recovery:legacy});
 assert.equal(second.nativeSessionId,opened.nativeSessionId);assert.equal(second.recovery.version,2);assert.ok(Buffer.byteLength(JSON.stringify(second.recovery))<16384);
 const result=await resumed.invoke('dev.aibo.codex.background-tasks.read',{taskId:'old-9'});assert.equal(result.output,'中'.repeat(4096));
 await resumed.client.close();
 const third=await sessionCapability(t,'codex',{},f.directory);
 const restored=await third.invoke('aibo.session.open',{mode:'resume',executionProfile,recovery:second.recovery});assert.equal(restored.nativeSessionId,opened.nativeSessionId);
 await third.invoke('aibo.session.turn',{text:'continue'},'next');
});

test('process death during a revision write or before publication preserves the previous entry',async t=>{
 const {spawnSync}=await import('node:child_process');
 const dir=root(t),store=new RecoveryStateStore(dir,'session'),ref=store.save({value:'last committed'});
 const moduleUrl=new URL('../packages/acp-adapter/recovery-state.mjs',import.meta.url).href;
 for(const phase of ['partial','committed']) {
   const child=spawnSync(process.execPath,['--input-type=module','-e',`
     import fs from 'node:fs';
     import {RecoveryStateStore} from ${JSON.stringify(moduleUrl)};
     if(process.argv[2]==='partial') {const write=fs.writeFileSync;fs.writeFileSync=(fd,data)=>{write(fd,data.subarray(0,10));process.kill(process.pid,'SIGKILL');};}
     new RecoveryStateStore(process.argv[1],'session').save({value:'unpublished revision'});
     process.kill(process.pid,'SIGKILL');
   `,dir,phase]);
   assert.equal(child.signal,'SIGKILL');assert.deepEqual(store.load(ref),{value:'last committed'});
 }
 assert.deepEqual(store.load(store.save({value:'retry'})),{value:'retry'});
});

test('background output controller rejects changed revisions and drops results after navigation',async()=>{
 const {createServer}=await import('vite');const server=await createServer({server:{middlewareMode:true,ws:false,watch:null},appType:'custom'});
 try {
   const {readBackgroundTaskPages,readBackgroundTaskOutput}=await server.ssrLoadModule('/src/lib/app/background-task-controller.ts');
   const calls=[];const pages=await readBackgroundTaskPages(async input=>{calls.push(input);return input.cursor?{tasks:[{id:'b'}],nextCursor:null}:{tasks:[{id:'a'}],nextCursor:'a'};});
   assert.equal(pages.tasks.length,2);assert.deepEqual(calls,[{},{cursor:'a'}]);
   let active=true;const discarded=await readBackgroundTaskOutput('task',async()=>{active=false;return{output:'partial',nextCursor:1,revision:'one'};},()=>active);assert.equal(discarded,null);
   let page=0;await assert.rejects(readBackgroundTaskOutput('task',async()=>++page===1?{output:'a',nextCursor:1,revision:'one'}:{output:'b',nextCursor:null,revision:'two'},()=>true),/changed/);
 } finally {await server.close();}
});

test('output retention and page boundaries do not split Unicode surrogate pairs',()=>{
 const tasks=new BackgroundTasks();tasks.update({id:'unicode',output:'🙂'.repeat(12001)},'turn');
 assert.equal(Array.from(tasks.list()[0].output).length,12000);
 let cursor=0,revision,output='';do {const page=tasks.read({taskId:'unicode',cursor,revision});output+=page.output;revision=page.revision;cursor=page.nextCursor;}while(cursor!==null);
 assert.equal(output,'🙂'.repeat(12000));assert.ok(tasks.read({taskId:'unicode'}).truncated);
});

test('an unrelated ACP provider migrates inline tasks and resumes through the generic worker',async t=>{
 const {sessionCapability}=await import('./helpers/session-capability.mjs');
 const profile={schema:'aibo.execution-profile/v1',networkPolicy:'agent-managed',model:null,reasoningEffort:null,interactionMode:'ask',filesystemPolicy:'read-only',commandPolicy:'disabled',approvalPolicy:'never',approvalReviewer:'none'};
 const f=await sessionCapability(t,'fixtures/plugins/acp-echo');
 const opened=await f.invoke('aibo.session.open',{mode:'create',executionProfile:profile});
 const legacy={...opened.recovery,version:1,data:{...opened.recovery.data,hasPrompt:true,backgroundTasks:[{id:'legacy',rootTurnId:'parent',status:'running',activity:'waiting',output:'x'.repeat(12000)}]}};
 const second=await f.restart();const resumed=await second.invoke('aibo.session.open',{mode:'resume',executionProfile:profile,recovery:legacy});
 assert.equal(resumed.nativeSessionId,opened.nativeSessionId);assert.equal(resumed.recovery.version,2);
 const store=new RecoveryStateStore(f.data,'session');const tasks=store.load(resumed.recovery.data.backgroundTasks);
 assert.equal(tasks[0].status,'unknown');assert.equal(tasks[0].output,'x'.repeat(12000));
 const third=await second.restart();const again=await third.invoke('aibo.session.open',{mode:'resume',executionProfile:profile,recovery:resumed.recovery});assert.equal(again.nativeSessionId,opened.nativeSessionId);
 await third.invoke('aibo.session.turn',{text:'continue ACP'},'next');
});
