import test from 'node:test';
import assert from 'node:assert/strict';
import { createCapabilityRuntime } from '../packages/capability-runtime/runtime.mjs';

const init = {protocol:'2.1',pluginId:'dev.test',pluginVersion:'1.0.0',contributionId:'dev.test.conversation',instanceId:'instance',generationId:'generation',installationId:'installation',privateData:{path:'/private',formatVersion:1}};
const operations = [{capability:'dev.test.turn',version:'1.0.0',operationId:'turn'},{capability:'dev.test.answer',version:'1.0.0',operationId:'answer'}];
const frame = (id,method,params) => ({jsonrpc:'2.0',id,method,params});
const tick = () => new Promise(resolve=>setImmediate(resolve));
function fixture(options={}) {
  const sent=[];
  const runtime=createCapabilityRuntime({...init,operations,invoke:()=>null,...options,send:message=>sent.push(message)});
  const request={invocationId:'invocation',instanceId:init.instanceId,generationId:init.generationId,contributionId:init.contributionId,capability:'dev.test.turn',contractVersion:'1.0.0',operationId:'turn',deadlineUnixMs:Date.now()+5000,scope:{kind:'session',id:'session'},context:{turnId:'turn',workspaceId:'workspace',workspacePath:'/workspace',originalCaller:{kind:'window',id:'main'},permissions:['workspace.read'],callChain:[]},input:{}};
  const control={invocationId:request.invocationId,instanceId:init.instanceId,generationId:init.generationId,contributionId:init.contributionId,capability:'dev.test.answer',contractVersion:'1.0.0',operationId:'answer',input:{answer:'yes'}};
  return {runtime,sent,request,control};
}

test('a running capability streams ordered events while accepting a scoped user response',async()=>{
  let emit,finish,answer;
  const f=fixture({invoke:(_request,tools)=>{emit=tools.emit;emit({type:'message.delta',delta:'hello'});return new Promise(resolve=>finish=resolve);},control:(request,tools)=>{answer={request,tools};emit({type:'input.received'});return {accepted:true};}});
  await f.runtime.receive(frame('init','capability.initialize',init));
  const running=f.runtime.receive(frame('run','capability.invoke',f.request));await tick();
  await f.runtime.receive(frame('answer','capability.control',f.control));
  assert.equal(answer.tools.invocation.context.workspacePath,'/workspace');
  assert.deepEqual(answer.request.input,{answer:'yes'});
  assert.deepEqual(f.sent.filter(m=>m.method==='capability.event').map(m=>m.params),[
    {instanceId:'instance',generationId:'generation',contributionId:init.contributionId,invocationId:'invocation',sequence:1,event:{type:'message.delta',delta:'hello'}},
    {instanceId:'instance',generationId:'generation',contributionId:init.contributionId,invocationId:'invocation',sequence:2,event:{type:'input.received'}},
  ]);
  assert.deepEqual(f.sent.find(m=>m.id==='answer').result.output,{accepted:true});
  finish({status:'completed'});await running;
  assert.throws(()=>emit({late:true}),/no longer active/);
  await f.runtime.receive(frame('late','capability.control',f.control));assert.ok(f.sent.at(-1).error);
  f.runtime.close();
});

test('control cannot change invocation authority or target stale identities',async()=>{
  let finish,calls=0;
  const f=fixture({invoke:()=>new Promise(resolve=>finish=resolve),control:()=>{calls++;return null;}});
  await f.runtime.receive(frame('init','capability.initialize',init));
  const running=f.runtime.receive(frame('run','capability.invoke',f.request));await tick();
  for (const patch of [{generationId:'old'},{instanceId:'other'},{invocationId:'other'},{contributionId:'other'},{operationId:'unknown'},{scope:{kind:'application'}},{permissions:['workspace.write']}]) {
    await f.runtime.receive(frame('bad','capability.control',{...f.control,...patch}));assert.ok(f.sent.at(-1).error);
  }
  assert.equal(calls,0);finish(null);await running;f.runtime.close();
});

test('terminal invocation aborts an unfinished control and rejects oversized stream frames',async()=>{
  let finish,finishControl,emit,signal;
  const f=fixture({invoke:(_p,tools)=>{emit=tools.emit;return new Promise(resolve=>finish=resolve);},control:(_p,tools)=>{signal=tools.signal;return new Promise(resolve=>finishControl=resolve);}});
  await f.runtime.receive(frame('init','capability.initialize',init));
  const running=f.runtime.receive(frame('run','capability.invoke',f.request));await tick();
  assert.throws(()=>emit('x'.repeat(262145)),/stream limit/);
  const controlling=f.runtime.receive(frame('answer','capability.control',f.control));await tick();
  await f.runtime.receive(frame('busy','capability.control',f.control));assert.ok(f.sent.at(-1).error);
  finish(null);await running;await controlling;assert.equal(signal.aborted,true);
  assert.ok(f.sent.find(m=>m.id==='answer').error);
  const count=f.sent.length;finishControl({late:true});await tick();assert.equal(f.sent.length,count);
  f.runtime.close();
});

test('protocol 2.0 never silently acquires interactive semantics',async()=>{
  const f=fixture({protocol:'2.0',invoke:(_p,tools)=>{assert.throws(()=>tools.emit({}),/requires/);return null;}});
  await f.runtime.receive(frame('wrong','capability.initialize',init));assert.ok(f.sent.at(-1).error);
  await f.runtime.receive(frame('init','capability.initialize',{...init,protocol:'2.0'}));
  await f.runtime.receive(frame('run','capability.invoke',f.request));assert.equal(f.sent.at(-1).result.output,null);
  await f.runtime.receive(frame('answer','capability.control',f.control));assert.ok(f.sent.at(-1).error);f.runtime.close();
});


test('handler failures preserve declared error categories in the host error envelope',async()=>{
  for(const [kind,expected] of [['unsupported','unsupported'],['permission_denied','permission_denied'],['invalid_session','invalid_input'],['native-internal','provider_unavailable']]){
    const f=fixture({invoke:()=>{throw Object.assign(new Error('native detail'),{kind});}});
    await f.runtime.receive(frame('init','capability.initialize',init));
    await f.runtime.receive(frame('run','capability.invoke',f.request));
    assert.deepEqual(f.sent.find(message=>message.id==='run').error,{code:-32000,message:'native detail',data:{kind:expected}});
  }
});
