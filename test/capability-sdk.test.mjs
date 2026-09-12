import test from 'node:test';
import assert from 'node:assert/strict';
import { createCapabilityRuntime } from '../packages/capability-sdk/runtime.mjs';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
const init = {protocol:'2.0',pluginId:'dev.sdk.test',pluginVersion:'1.0.0',contributionId:'dev.sdk.test.worker',instanceId:'instance',generationId:'generation',installationId:'installation',privateData:{path:'/private',formatVersion:1}};
const operation = {capability:'dev.sdk.read',version:'1.0.0',operationId:'read'};
const request = () => ({invocationId:'invocation',instanceId:'instance',generationId:'generation',contributionId:init.contributionId,capability:operation.capability,contractVersion:'1.0.0',operationId:'read',deadlineUnixMs:Date.now()+5000,scope:{kind:'application'},context:{turnId:null,workspaceId:null,workspacePath:null,originalCaller:{kind:'window',id:'main'},permissions:[],callChain:[]},input:{value:'original'}});
const frame = (id,method,params) => ({jsonrpc:'2.0',id,method,params});
function fixture(invoke) {
  const sent=[];
  return {sent,runtime:createCapabilityRuntime({...init,operations:[operation],invoke,send:message=>sent.push(message)})};
}
test('SDK negotiates exact identities and refuses uninitialized, stale, expired and unsupported invocations',async()=>{
  let calls=0; const {runtime,sent}=fixture(p=>{calls++;return p.input;});
  await runtime.receive(frame(1,'capability.invoke',request()));assert.ok(sent.at(-1).error);
  await runtime.receive(frame(2,'capability.initialize',init));assert.deepEqual(sent.at(-1).result.operations,[operation]);
  await runtime.receive(frame(3,'capability.initialize',init));assert.equal(sent.at(-1).result.generationId,'generation');
  for(const patch of [{generationId:'stale'},{operationId:'unregistered'},{deadlineUnixMs:0}]) {
    await runtime.receive(frame(4,'capability.invoke',{...request(),...patch}));assert.ok(sent.at(-1).error);
  }
  assert.equal(calls,0);
  await runtime.receive(frame(5,'capability.invoke',request()));
  assert.deepEqual(sent.at(-1).result,{invocationId:'invocation',generationId:'generation',output:{value:'original'}});
  runtime.close();
});
test('SDK correlates child calls and supplies parent identity without accepting host authority overrides',async()=>{
  let tools;const {runtime,sent}=fixture(async(_p,context)=>{tools=context;return (await context.call({pluginId:'dev.child',contributionId:'dev.child.worker',capability:'dev.child.read',version:'1.0.0',input:{}})).output;});
  await runtime.receive(frame(1,'capability.initialize',init));
  const running=runtime.receive(frame(2,'capability.invoke',request()));await new Promise(resolve=>setImmediate(resolve));
  const child=sent.at(-1);assert.equal(child.method,'capability.call');assert.equal(child.params.invocationId,'invocation');assert.equal(child.params.generationId,'generation');
  assert.equal(child.params.scope,undefined);assert.equal(child.params.permissions,undefined);
  await assert.rejects(tools.call({scope:{kind:'application'}}),/host authority/);
  await runtime.receive({jsonrpc:'2.0',id:child.id,result:{ok:true,response:{output:{child:true}}}});await running;
  assert.deepEqual(sent.at(-1).result.output,{child:true});
  await assert.rejects(tools.call({}),/no longer active/);
  await assert.rejects(runtime.receive({jsonrpc:'2.0',id:child.id,result:{ok:true}}),/Unknown/);
  runtime.close();
});
test('SDK reports child rejection without retries and discards a handler completion after its deadline',async()=>{
  const first=fixture(async(_p,tools)=>{await tools.call({pluginId:'dev.child',contributionId:'dev.child.worker',capability:'dev.child.read',version:'1.0.0',input:{}});return null;});
  await first.runtime.receive(frame(1,'capability.initialize',init));
  const run=first.runtime.receive(frame(2,'capability.invoke',request()));await new Promise(resolve=>setImmediate(resolve));
  await first.runtime.receive({jsonrpc:'2.0',id:first.sent.at(-1).id,result:{ok:false,error:{code:'approval_rejected',message:'Denied',invocationId:null}}});await run;
  assert.equal(first.sent.filter(m=>m.method==='capability.call').length,1);assert.equal(first.sent.at(-1).error.message,'Denied');first.runtime.close();
  let finish,signal;const slow=fixture((_p,tools)=>{signal=tools.signal;return new Promise(resolve=>finish=resolve);});
  await slow.runtime.receive(frame(1,'capability.initialize',init));
  await slow.runtime.receive(frame(2,'capability.invoke',{...request(),deadlineUnixMs:Date.now()+30}));
  assert.equal(signal.aborted,true);assert.match(slow.sent.at(-1).error.message,/deadline/);
  const count=slow.sent.length;finish({late:true});await new Promise(resolve=>setImmediate(resolve));assert.equal(slow.sent.length,count);slow.runtime.close();
});

test('SDK stdio worker negotiates and replies through a real process',async()=>{
  const entry=new URL('../packages/capability-sdk/stdio.mjs',import.meta.url).href;
  const child=spawn(process.execPath,['--input-type=module','--eval',`import {serveCapability} from ${JSON.stringify(entry)};serveCapability({...${JSON.stringify(init)},operations:${JSON.stringify([operation])},invoke:async p=>p.input});`],{stdio:['pipe','pipe','pipe']});
  const exited=once(child,'exit');const lines=createInterface({input:child.stdout});
  let errors='';child.stderr.on('data',chunk=>errors+=chunk);
  async function exchange(message) {
    let timer;
    try {
      const response=Promise.race([once(lines,'line'),exited.then(()=>{throw Error('Worker exited: '+errors);}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Worker response timeout: '+errors)),5000);})]);
      child.stdin.write(JSON.stringify(message)+'\n');
      return JSON.parse((await response)[0]);
    } finally {clearTimeout(timer);}
  }
  try {
    assert.equal((await exchange(frame(1,'capability.initialize',init))).result.protocol,'2.0');
    const response=await exchange(frame(2,'capability.invoke',request()));
    assert.deepEqual(response.result,{invocationId:'invocation',generationId:'generation',output:{value:'original'}});
    child.stdin.end();await exited;assert.equal(child.exitCode,0);assert.equal(errors,'');
  } finally {lines.close();if(child.exitCode===null)child.kill();await exited;}
});
