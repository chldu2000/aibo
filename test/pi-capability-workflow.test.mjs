import assert from 'node:assert/strict';
import test from 'node:test';
import {sessionCapability} from './helpers/session-capability.mjs';

const profile={interactionMode:'ask',filesystemPolicy:'read-only',commandPolicy:'disabled',networkPolicy:'disabled',approvalPolicy:'untrusted'};

test('Pi capability workflow preserves commands, queue, retries, tree navigation and compaction',async t=>{
  const f=await sessionCapability(t,'pi');
  await f.invoke('aibo.session.open',{mode:'create',executionProfile:profile});
  const commands=await f.invoke('dev.aibo.pi.command.list');
  assert.ok(commands.commands.some(command=>command.name==='review'));
  assert.ok((await f.invoke('dev.aibo.pi.skill.list')).skills.some(skill=>skill.name==='parity'));
  await f.invoke('dev.aibo.pi.model.reasoning',{action:'set',level:'high'});
  assert.equal((await f.invoke('dev.aibo.pi.model.reasoning',{action:'list'})).current,'high');
  const turn=f.startTurn('queue parity prompt','queue');
  await f.control(turn,'dev.aibo.pi.queue.manage',{action:'followUp',message:'follow-up parity'});
  await f.control(turn,'dev.aibo.pi.queue.manage',{action:'clear'});
  await f.control(turn,'dev.aibo.pi.queue.manage',{action:'steer',message:'steer parity'});
  assert.equal((await turn.done).status,'completed');
  const queues=f.events.filter(e=>e.event.type==='queue.updated').map(e=>e.event.payload);
  assert.ok(queues.some(queue=>queue.followUp.includes('follow-up parity')));
  assert.ok(queues.some(queue=>queue.followUp.length===0&&queue.steering.length===0));
  assert.ok(queues.some(queue=>queue.steering.includes('steer parity')));
  await f.invoke('aibo.session.turn',{text:'retry parity prompt'},'retry');
  assert.ok(f.events.some(e=>e.event.type==='retry.started'));
  assert.ok(f.events.some(e=>e.event.type==='retry.completed'&&e.event.payload.success===false));
  const snapshot=await f.invoke('dev.aibo.pi.session.snapshot');
  const nodes=[...snapshot.tree];let user;
  while(nodes.length){const node=nodes.shift();if(node.type==='message'&&node.role==='user'){user=node;break;}nodes.push(...(node.children??[]));}
  assert.ok(user?.id);
  const navigation=await f.invoke('dev.aibo.pi.session.tree',{action:'navigate',entryId:user.id,summarize:false});
  assert.equal(navigation.cancelled,false);
  assert.equal(navigation.leafId,user.id);
  const compact=await f.invoke('dev.aibo.pi.compaction.run',{instructions:'retain parity decisions'});
  assert.equal(compact.summary,'retain parity decisions');
  assert.ok(f.events.some(e=>e.event.type==='compaction.started'));
  assert.ok(f.events.some(e=>e.event.type==='compaction.completed'));
  assert.ok(f.frames.every(frame=>!['agent/event','aibo/event','view/render'].includes(frame.method)));
});

test('Pi capability cancellation permits a new turn and preserves navigable structured history across restart',async t=>{
  const f=await sessionCapability(t,'pi');
  const opened=await f.invoke('aibo.session.open',{mode:'create',executionProfile:profile});
  const turn=f.startTurn('queue parity prompt','abort');
  await f.control(turn,'aibo.session.cancel');
  assert.equal((await turn.done).status,'interrupted');
  for(const text of ['missing completion','late completion']){
    await f.invoke('aibo.session.turn',{text},text);
    assert.deepEqual(f.events.filter(e=>e.event.turnId===text&&e.event.type==='message.completed').map(e=>e.event.payload.text),[text]);
  }
  const text='after abort '.repeat(100).trim();
  await f.invoke('aibo.session.turn',{text},'after');
  const before=await f.invoke('dev.aibo.pi.session.snapshot');
  const user=before.branch.findLast(entry=>entry.role==='user');
  assert.equal(user.summary,text);
  await f.invoke('dev.aibo.pi.session.tree',{action:'navigate',entryId:user.id,summarize:false});
  assert.equal((await f.invoke('dev.aibo.pi.session.snapshot')).branch.at(-1).id,user.id);
  await f.invoke('dev.aibo.pi.session.tree',{action:'navigate',entryId:before.leafId,summarize:false});
  assert.deepEqual((await f.invoke('dev.aibo.pi.session.snapshot')).branch,before.branch);
  const completed=await f.invoke('aibo.session.turn',{text:'structured assistant fixture'},'structured');
  const structured=(await f.invoke('dev.aibo.pi.session.snapshot')).branch.at(-1);
  assert.deepEqual(structured.parts.map(({role,type})=>[role,type]),[['system','reasoning'],['tool','tool_call'],['assistant','message']]);
  assert.equal(structured.parts[1].toolName,'read');
  assert.deepEqual(JSON.parse(structured.parts[1].summary),{path:'README.md'});
  assert.ok(!JSON.stringify(structured).includes('private fixture reasoning'));
  const restarted=await f.restart();
  const resumed=await restarted.invoke('aibo.session.open',{mode:'resume',executionProfile:{...profile,model:'fake/fake-alt',reasoningEffort:'high'},recovery:completed.recovery});
  assert.equal(resumed.nativeSessionId,opened.nativeSessionId);
  assert.deepEqual(resumed.recovery.data.model,{provider:'fake',modelId:'fake-alt'});
  assert.equal(resumed.recovery.data.thinkingLevel,'high');
  assert.deepEqual((await restarted.invoke('dev.aibo.pi.session.snapshot')).branch.at(-1),structured);
});

test('Pi capability opens a session using the installed locked SDK',async t=>{
  const {fileURLToPath}=await import('node:url');
  const f=await sessionCapability(t,'pi',{AIBO_PI_SDK_MODULE:fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))});
  assert.ok((await f.invoke('aibo.session.open',{mode:'create',executionProfile:profile})).nativeSessionId);
  assert.ok((await f.invoke('dev.aibo.pi.command.list')).commands.some(command=>command.name==='compact'));
  assert.ok(Array.isArray((await f.invoke('dev.aibo.pi.session.snapshot')).tree));
  await f.invoke('aibo.session.close');
});

test('Pi image, write and command tools use capability stream requests and host responses',async t=>{
  const f=await sessionCapability(t,'pi');
  await f.invoke('aibo.session.open',{mode:'create',executionProfile:{...profile,interactionMode:'edit',filesystemPolicy:'workspace-write',commandPolicy:'approved',approvalPolicy:'on-request'}});
  const requests=[];let active,replies=Promise.resolve();
  f.client.on('message',frame=>{
    const event=frame.params?.event;if(event?.type!=='workspace.requested')return;
    const request=event.payload;requests.push(request);const input=request.input;
    const result=request.tool==='write_file'?{path:input.path,bytes:input.content.length,tool:'write_file'}
      :request.tool==='run_command'?{command:input.command,cwd:input.cwd,exitCode:0,stdout:'AIBO_PLUGIN_COMMAND_OK',stderr:'',output:'AIBO_PLUGIN_COMMAND_OK'}
      :input.action==='image_mime'?{path:input.path,mimeType:'image/png'}
      :{path:input.path,data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',encoding:'base64',mimeType:'image/png',bytes:68};
    replies=replies.then(()=>f.control(active,'aibo.session.tool.respond',{requestId:request.requestId,result}));replies.catch(()=>{});
  });
  for(const action of ['image','write','bash']){
    active=f.startTurn(`core plugin ${action} fixture`,action,'aibo.session.turn.write',['workspace.read','workspace.write']);
    assert.equal((await active.done).status,'completed');await replies;
    assert.ok(f.events.some(e=>e.event.turnId===action&&e.event.type==='tool.completed'));
  }
  assert.deepEqual(requests.map(request=>request.tool),['read_file','read_file','read_file','write_file','run_command']);
  assert.deepEqual(requests.slice(0,3).map(request=>request.input.action),['access','image_mime','read']);
});
