import test from 'node:test';
import assert from 'node:assert/strict';
import {sessionCapability} from './helpers/session-capability.mjs';

const profile={interactionMode:'ask',filesystemPolicy:'read-only',commandPolicy:'disabled',networkPolicy:'disabled',approvalPolicy:'on-request',approvalReviewer:'user'};

test('Codex auto-review profile uses the native approve-for-me reviewer',async t=>{
  const f=await sessionCapability(t,'codex',{CODEX_FAKE_EXPECT_REVIEWER:'auto_review'});
  await f.invoke('aibo.session.open',{mode:'create',executionProfile:{...profile,interactionMode:'edit',filesystemPolicy:'workspace-write',commandPolicy:'trusted',approvalReviewer:'auto-review'}});
});
test('Codex capability provider streams turns, controls native requests and restores native recovery',async t=>{
  const f=await sessionCapability(t,'codex');
  await assert.rejects(f.rpc('aibo.initialize',{}),/Unsupported/);
  const initialUsageReady=f.wait('usage.updated');
  const opened=await f.invoke('aibo.session.open',{mode:'create',executionProfile:profile});
  assert.equal(opened.nativeSessionId,'native-thread');
  assert.ok(opened.capabilities.includes('approval.respond'));
  assert.ok(opened.capabilities.includes('model.service-tier'), 'Fast must be advertised to the host before the UI can invoke it');
  const initialUsage=await initialUsageReady;
  assert.equal(initialUsage.payload.usage.plan,'plus');
  assert.equal(initialUsage.payload.usage.limits[0].usedPercent,20);
  assert.equal((await f.invoke('aibo.session.turn',{text:'hello plugin'},'first')).status,'completed');
  const combinedUsage=f.events.filter(e=>e.event.type==='usage.updated').at(-1).event.payload.usage;
  assert.equal(combinedUsage.total.totalTokens,1234);
  assert.equal(combinedUsage.plan,'plus');
  assert.equal(f.events.filter(e=>e.event.type==='message.delta').map(e=>e.event.payload.delta).join(''),'hello plugin');
  assert.equal((await f.invoke('dev.aibo.codex.model.select',{action:'set',reference:'gpt-fake'})).current,'gpt-fake');
  assert.equal((await f.invoke('dev.aibo.codex.model.reasoning',{action:'set',level:'high'})).current,'high');
  assert.equal((await f.invoke('dev.aibo.codex.model.service-tier',{action:'set',tier:'priority'})).current,'priority');
  const skill=(await f.invoke('dev.aibo.codex.skill.list')).skills[0];
  assert.deepEqual({name:skill.name,description:skill.description,source:skill.source,category:skill.category,execution:skill.execution},
    {name:'review',description:'Review code',source:'skill',category:'skill',execution:'prompt'});
  assert.equal((await f.invoke('dev.aibo.codex.goal.manage',{action:'set',objective:'Migrate',tokenBudget:2000})).goal.objective,'Migrate');
  assert.equal((await f.invoke('dev.aibo.codex.goal.manage',{action:'clear'})).goal,null);
  await f.invoke('aibo.session.turn',{text:'tool please'},'tools');
  const toolEvents=f.events.filter(e=>e.event.turnId==='tools').map(e=>e.event);
  assert.deepEqual(toolEvents.filter(e=>e.type.startsWith('tool.')).map(e=>e.type),['tool.started','tool.updated','tool.completed']);
  assert.equal(toolEvents.find(e=>e.type==='tool.completed').payload.output,'tool output\n');
  assert.deepEqual(toolEvents.filter(e=>e.type.startsWith('reasoning.')).map(e=>e.type),['reasoning.updated','reasoning.completed']);
  assert.equal(toolEvents.find(e=>e.type==='reasoning.completed').payload.summary,'Checking the workspace.');
  assert.deepEqual(toolEvents.filter(e=>['message.completed','tool.started'].includes(e.type)).map(e=>[e.type,e.payload.itemId]),[
    ['message.completed','commentary-1'],['tool.started','command-1'],['message.completed','message'],
  ]);
  const waiting=f.wait('approval.requested');const turn=f.startTurn('approval please','approval');
  const approval=await waiting;
  assert.equal((await f.control(turn,'dev.aibo.codex.approval.respond',{requestId:approval.payload.requestId,decision:'accept'})).resolved,true);
  assert.equal((await turn.done).status,'completed');
  const permissionWaiting=f.wait('approval.requested');const permissionTurn=f.startTurn('permissions please','permissions');
  const permissionApproval=await permissionWaiting;
  assert.equal(permissionApproval.payload.kind,'permissions');
  assert.match(permissionApproval.payload.command,/\.git/);
  assert.equal((await f.control(permissionTurn,'dev.aibo.codex.approval.respond',{requestId:permissionApproval.payload.requestId,decision:'accept'})).resolved,true);
  assert.equal((await permissionTurn.done).status,'completed');
  const input=f.wait('user_input.requested');const question=f.startTurn('input please','question');
  await input;
  assert.equal((await f.control(question,'dev.aibo.codex.user-input.respond',{requestId:'provider-input',answers:{choice:['yes']}})).resolved,true);
  const completed=await question.done;assert.equal(completed.status,'completed');
  assert.equal(completed.recovery.data.model,'gpt-fake');assert.equal(completed.recovery.data.reasoningEffort,'high');
  await f.invoke('aibo.session.close');
  const recovered=await f.invoke('aibo.session.open',{mode:'resume',executionProfile:profile,recovery:completed.recovery});
  assert.equal(recovered.nativeSessionId,opened.nativeSessionId);
  assert.equal(recovered.recovery.data.model,'gpt-fake');
  assert.ok(f.frames.every(frame=>!['agent/event','view/render','aibo/tool-request'].includes(frame.method)));
  const byInvocation=Map.groupBy(f.events,event=>event.invocationId);
  for(const events of byInvocation.values())assert.deepEqual(events.map(event=>event.sequence),events.map((_,i)=>i+1));
  const restarted=await f.restart();
  assert.notEqual(restarted.identity.generationId,f.identity.generationId);
  const restored=await restarted.invoke('aibo.session.open',{mode:'resume',executionProfile:profile,recovery:completed.recovery});
  assert.equal(restored.recovery.data.model,'gpt-fake');
  assert.equal(restored.recovery.data.reasoningEffort,'high');
  assert.equal((await restarted.invoke('aibo.session.turn',{text:'after restart'},'resumed')).status,'completed');
  await restarted.client.close();
});

test('Pi SDK capability provider preserves message identity and routes workspace tools through stream controls',async t=>{
  const f=await sessionCapability(t,'pi');
  const opened=await f.invoke('aibo.session.open',{mode:'create',executionProfile:profile});
  assert.ok(opened.nativeSessionId);
  assert.equal((await f.invoke('aibo.session.turn',{text:'two identical no ids'},'messages')).status,'completed');
  assert.deepEqual(f.events.filter(e=>e.event.turnId==='messages'&&e.event.type==='message.completed').map(e=>[e.event.payload.itemId,e.event.payload.text]),[['assistant-1','same reply'],['assistant-2','same reply']]);
  assert.ok(Array.isArray((await f.invoke('dev.aibo.pi.model.select',{action:'list'})).models));
  assert.ok(Array.isArray((await f.invoke('dev.aibo.pi.session.tree',{action:'get'})).tree));
  const toolRequests=[];let replies=Promise.resolve();
  const turn=f.startTurn('core plugin read','read');
  f.client.on('message',frame=>{
    const event=frame.params?.event;if(event?.type!=='workspace.requested')return;
    toolRequests.push(event.payload);
    const input=event.payload.input;
    const result=input.action==='image_mime'?{path:input.path,mimeType:null}:{path:input.path,content:'host text',bytes:9};
    replies=replies.then(async()=>assert.equal((await f.control(turn,'aibo.session.tool.respond',{requestId:event.payload.requestId,result})).resolved,true));
    replies.catch(()=>{});
  });
  assert.equal((await turn.done).status,'completed');
  await replies;
  assert.deepEqual(toolRequests.map(tool=>tool.input.action),['access','image_mime','read']);
  assert.ok(toolRequests.every(tool=>tool.tool==='read_file'));
  assert.ok(f.frames.every(frame=>!['agent/event','view/render','aibo/tool-request'].includes(frame.method)));
});

test('session provider cannot execute a writable profile through a read invocation',async t=>{
  const f=await sessionCapability(t,'codex');
  await f.invoke('aibo.session.open',{mode:'create',executionProfile:{...profile,filesystemPolicy:'workspace-write'}});
  await assert.rejects(f.invoke('aibo.session.turn',{text:'must not run'},'forbidden'),/approved write/);
  assert.equal(f.events.filter(e=>e.event.type==='turn.started').length,0);
  assert.equal((await f.invoke('aibo.session.turn.write',{text:'approved'},'allowed',['workspace.read','workspace.write'])).status,'completed');
});


test('Codex thread snapshots and forks use native identities without replacing the source recovery', async t => {
  const f = await sessionCapability(t, 'codex');
  const opened = await f.invoke('aibo.session.open', {mode:'create',executionProfile:profile});
  await f.invoke('aibo.session.turn', {text:'fork boundary'}, 'host-turn');
  const started = f.events.find(event=>event.event.type==='turn.started');
  assert.equal(started.event.turnId, 'host-turn');
  assert.equal(started.event.payload.nativeTurnId, 'native-turn');
  const snapshot = await f.invoke('dev.aibo.codex.session.snapshot');
  assert.equal(snapshot.thread.id, opened.nativeSessionId);
  assert.equal(snapshot.thread.turnCount, 1);
  assert.equal(snapshot.thread.status, 'idle');
  await assert.rejects(f.invoke('dev.aibo.codex.session.fork', {nativeTurnId:'host-turn'}), /boundary/);
  const fork = await f.invoke('dev.aibo.codex.session.fork', {nativeTurnId:'native-turn'});
  assert.equal(fork.fork.nativeSessionId, 'forked-thread');
  assert.equal(fork.fork.recovery.data.threadId, 'forked-thread');
  assert.equal(fork.recovery.data.threadId, opened.nativeSessionId);
  const invalid = await sessionCapability(t, 'codex', {CODEX_FAKE_FORK_SAME_THREAD:'1'});
  await invalid.invoke('aibo.session.open', {mode:'create',executionProfile:profile});
  await assert.rejects(invalid.invoke('dev.aibo.codex.session.fork'), /fork identity/);
});


test('Codex workspace catalog is a separate pinned contribution and cannot switch to session execution', async t => {
  const f = await sessionCapability(t, 'codex', {}, undefined, 'dev.aibo.codex.catalog');
  const result = await f.invoke('aibo.session.catalog');
  assert.equal(result.threads[0].id, 'catalog-thread');
  assert.equal(result.threads[0].cwd, f.directory);
  assert.equal(result.threads[0].status, 'idle');
  assert.equal(f.events.length, 0, 'catalog reads do not start conversations');
  await assert.rejects(f.rpc('capability.initialize', {...f.identity,contributionId:'dev.aibo.codex.agent',protocol:'2.1',pluginId:'dev.aibo.codex',pluginVersion:'2.0.1'}), /initialization/);
  assert.equal((await f.invoke('aibo.session.catalog')).threads.length, 1);
});


test('Codex capability open refuses a native sandbox downgrade before any turn', async t => {
  const f = await sessionCapability(t, 'codex', {CODEX_FAKE_SANDBOX:'dangerFullAccess'});
  await assert.rejects(f.invoke('aibo.session.open',{mode:'create',executionProfile:profile}), /requested approval and sandbox policy/);
  assert.equal(f.events.some(event=>event.event.type==='turn.started'),false);
});

test('Codex capability resumes an unmaterialized first rollout with its saved model settings',async t=>{
  const f=await sessionCapability(t,'codex',{CODEX_FAKE_MISSING_ROLLOUT:'1',CODEX_FAKE_THREAD_ID:'replacement-thread'});
  const created=await f.invoke('aibo.session.open',{mode:'create',executionProfile:profile});
  await f.invoke('aibo.session.close');
  const recovery={...created.recovery,data:{...created.recovery.data,model:'gpt-fake',reasoningEffort:'high'}};
  const resumed=await f.invoke('aibo.session.open',{mode:'resume',executionProfile:profile,recovery});
  assert.equal(resumed.nativeSessionId,'replacement-thread');
  assert.equal(resumed.recovery.data.model,'gpt-fake');
  assert.equal(resumed.recovery.data.reasoningEffort,'high');
  assert.equal((await f.invoke('dev.aibo.codex.model.select',{action:'list'})).models[0].id,'gpt-fake');
});


test('Codex metadata snapshot does not require native turn-list support',async t=>{
  const f=await sessionCapability(t,'codex',{CODEX_FAKE_NO_TURNS:'1'});
  await f.invoke('aibo.session.open',{mode:'create',executionProfile:profile});
  const snapshot=await f.invoke('dev.aibo.codex.session.snapshot');
  assert.equal(snapshot.thread.id,'native-thread');
  assert.equal(snapshot.thread.turnCount,null,'unavailable turn count must remain unknown');
  await assert.rejects(f.invoke('dev.aibo.codex.session.fork',{nativeTurnId:'missing'}),/list_turns/);
});

test('Codex goal resume owns all native continuations until the goal completes', async t => {
  const f = await sessionCapability(t, 'codex', {CODEX_FAKE_GOAL_MODE:'complete'});
  const opened = await f.invoke('aibo.session.open', {mode:'create',executionProfile:profile});
  assert.ok(opened.capabilities.includes('goal.resume'));
  assert.ok(opened.capabilities.includes('goal.pause'));
  const initial = await f.invoke('dev.aibo.codex.goal.manage',{action:'set',objective:'Migrate safely',tokenBudget:2000});
  assert.equal(initial.goal.status,'paused', 'creating a goal cannot start execution outside an admitted run');
  assert.equal((await f.invoke('aibo.session.goal.resume',{},'goal-run')).status,'completed');
  const events = f.events.map(e=>e.event).filter(e=>e.turnId==='goal-run');
  assert.equal(events.filter(e=>e.type==='turn.started').length,2);
  assert.equal(events.filter(e=>e.type==='turn.completed').length,1);
  const messages = events.filter(e=>e.type==='message.completed');
  assert.deepEqual(messages.map(e=>e.payload.text),['Goal step 1','Goal step 2']);
  assert.equal(new Set(messages.map(e=>e.payload.itemId)).size,2,'native item reuse must not overwrite earlier steps');
  const final = (await f.invoke('dev.aibo.codex.goal.manage',{action:'get'})).goal;
  assert.equal(final.objective,'Migrate safely'); assert.equal(final.tokenBudget,2000);
  assert.equal(final.tokensUsed,100); assert.equal(final.status,'complete');
  await assert.rejects(f.invoke('aibo.session.goal.resume',{},'finished'),/cannot be resumed/);
});

test('Codex pauses the persisted goal before interrupting, then resumes the same goal', async t => {
  const f = await sessionCapability(t, 'codex', {CODEX_FAKE_GOAL_MODE:'hold'});
  await f.invoke('aibo.session.open',{mode:'create',executionProfile:profile});
  await f.invoke('dev.aibo.codex.goal.manage',{action:'set',objective:'Keep working',tokenBudget:250});
  for (const turnId of ['first-goal-run','resumed-goal-run']) {
    const started = f.wait('turn.started');
    const request = f.request('aibo.session.goal.resume',{},turnId);
    const run = {request,done:f.rpc('capability.invoke',request)};
    await started;
    const reading = await f.control(run,'dev.aibo.codex.goal.manage',{action:'get'});
    assert.equal(reading.goal.status,'active','goal reads remain available during execution');
    const result = await f.control(run,'dev.aibo.codex.goal.manage',{action:'pause'});
    assert.equal(result.goal.status,'paused'); assert.equal(result.goal.objective,'Keep working');
    assert.equal(result.goal.tokenBudget,250); assert.equal(result.goal.tokensUsed,0);
    assert.equal((await run.done).output.status,'interrupted');
    const stream=f.events.map(e=>e.event);
    const pauseIndex=stream.findLastIndex(e=>e.type==='goal.updated'&&e.payload.goal?.status==='paused');
    const endIndex=stream.findLastIndex(e=>e.type==='turn.completed');
    assert.ok(pauseIndex>=0 && endIndex>pauseIndex);
  }
});

test('goal resume preserves write admission and surfaces native errors without starting a turn', async t => {
  const f = await sessionCapability(t,'codex',{CODEX_FAKE_GOAL_RESUME_FAIL:'1'});
  await f.invoke('aibo.session.open',{mode:'create',executionProfile:{...profile,filesystemPolicy:'workspace-write'}});
  await f.invoke('dev.aibo.codex.goal.manage',{action:'set',objective:'Protected goal'});
  await assert.rejects(f.invoke('aibo.session.goal.resume',{},'unsafe'),/approved write/);
  await assert.rejects(f.invoke('aibo.session.goal.resume.write',{},'rejected',['workspace.read','workspace.write']),/resume rejected/);
  assert.equal(f.events.some(e=>e.event.type==='turn.started'),false);
  assert.equal((await f.invoke('dev.aibo.codex.goal.manage',{action:'get'})).goal.status,'paused');
});

test('a failed native interrupt reports failure while retaining pause and the live run', async t => {
  const f=await sessionCapability(t,'codex',{CODEX_FAKE_GOAL_MODE:'hold',CODEX_FAKE_INTERRUPT_FAIL:'1'});
  await f.invoke('aibo.session.open',{mode:'create',executionProfile:profile});
  await f.invoke('dev.aibo.codex.goal.manage',{action:'set',objective:'Pause safely'});
  const started=f.wait('turn.started');
  const request=f.request('aibo.session.goal.resume',{},'pause-failure');
  const run={request,done:f.rpc('capability.invoke',request)};
  run.done.catch(()=>{});
  await started;
  await assert.rejects(f.control(run,'dev.aibo.codex.goal.manage',{action:'pause'}),/interrupt failed/);
  const goal=(await f.control(run,'dev.aibo.codex.goal.manage',{action:'get'})).goal;
  assert.equal(goal.status,'paused');
  assert.equal(f.events.some(e=>e.event.turnId==='pause-failure'&&e.event.type==='turn.completed'),false,'failed interrupt must not fabricate terminal execution');
});
