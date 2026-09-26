import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createHostToolChannel, createHostToolMcpBridge, hostToolDefinitions } from '../packages/capability-runtime/host-tools.mjs';
const catalog=JSON.parse(await readFile(new URL('../contracts/host-tools.v1.json',import.meta.url)));
const request=(id='t')=>({invocationId:id,deadlineUnixMs:Date.now()+5000,context:{turnId:id,hostTools:catalog}});

test('host tool channel binds responses, cancellation and available names to one invocation',async()=>{
 const channel=createHostToolChannel(), abort=new AbortController(), events=[];
 const end=channel.begin(request(),{signal:abort.signal,emit:event=>events.push(event)},()=> 'native');
 await assert.rejects(channel.call('read_file',{}),/not available/);
 const pending=channel.call('aibo_read_session',{referenceId:'r',sessionId:'s'});
 assert.equal(events[0].nativeSessionId,'native');assert.equal(events[0].turnId,'t');
 assert.throws(()=>channel.respond({requestId:'forged'}),/no longer pending/);
 channel.respond({requestId:events[0].payload.requestId,result:{content:'原文'}});
 assert.deepEqual(await pending,{content:'原文'});
 const cancelled=channel.call('aibo_read_session',{});abort.abort();await assert.rejects(cancelled,/cancelled/);end();
 await assert.rejects(channel.call('aibo_read_session',{}),/not available/);
 const nextEnd=channel.begin(request('next'),{signal:new AbortController().signal,emit:event=>events.push(event)},()=> 'native');
 assert.throws(()=>channel.respond({requestId:events[1].payload.requestId}),/no longer pending/);nextEnd();
 assert.deepEqual(hostToolDefinitions({}),[]);assert.throws(()=>hostToolDefinitions({hostTools:{schema:'wrong',tools:[]}}),/Invalid/);
});

test('packaged MCP stdio bridge discovers any host catalog and forwards results and errors',async()=>{
 const definitions=structuredClone(catalog.tools);definitions[0].name='third_party_history';
 delete definitions[0].outputSchema;
 const channel=createHostToolChannel();let emitted;
 const context={schema:'aibo.host-tools/v1',tools:definitions};
 const end=channel.begin({...request(),context:{turnId:'t',hostTools:context}},{signal:new AbortController().signal,emit:event=>{
   emitted=event;queueMicrotask(()=>channel.respond({requestId:event.payload.requestId,...(event.payload.input.sessionId==='fail'?{error:'permission_denied: foreign source'}:{result:{content:'完整原文',nextCursor:null}})}));
 }},()=> 'native');
 const bridge=await createHostToolMcpBridge({definitions,call:channel.call});
 const client=new Client({name:'aibo-test',version:'1.0.0'});
 const transport=new StdioClientTransport({...bridge.configuration,stderr:'pipe'});
 try{
  await client.connect(transport);assert.deepEqual((await client.listTools()).tools,definitions);await bridge.ready;
  const result=await client.callTool({name:'third_party_history',arguments:{referenceId:'r',sessionId:'s'}});
  assert.equal(result.structuredContent.content,'完整原文');assert.equal(emitted.payload.tool,'third_party_history');
  const denied=await client.callTool({name:'third_party_history',arguments:{referenceId:'r',sessionId:'fail'}});
  assert.equal(denied.isError,true);assert.match(denied.content[0].text,/permission_denied/);
  const forged=await fetch(bridge.configuration.env.AIBO_HOST_TOOL_ENDPOINT+'/list',{method:'POST',body:'{}'});assert.equal(forged.status,403);
  end();const expired=await client.callTool({name:'third_party_history',arguments:{referenceId:'r',sessionId:'s'}});assert.equal(expired.isError,true);
 }finally{end();await client.close();await bridge.close();}
});


const profile={interactionMode:'ask',filesystemPolicy:'read-only',commandPolicy:'disabled',networkPolicy:'disabled',approvalPolicy:'on-request',approvalReviewer:'user'};
const {sessionCapability}=await import('./helpers/session-capability.mjs');
for(const name of ['codex','pi']) test(`${name} registers catalog tools, forwards host responses and restores after restart`,async t=>{
 let f=await sessionCapability(t,name,name==='codex'?{CODEX_FAKE_EXPECT_HOST_TOOLS:'1'}:{},undefined,undefined,catalog);
 let opened=await f.invoke('aibo.session.open',{mode:'create',executionProfile:profile});
 assert.ok(opened.capabilities.includes('host-tools'));
 for(let iteration=0;iteration<2;iteration++){
  const requested=f.wait('workspace.requested');const turn=f.startTurn('host history fixture',`history-${iteration}`);
  const event=await requested;
  assert.equal(event.payload.tool,'aibo_read_session');assert.equal(event.payload.input.referenceId,'ref');
  await f.control(turn,'aibo.session.tool.respond',{requestId:event.payload.requestId,result:{content:'AIBO_FULL_HISTORY',nextCursor:null}});
  const output=await turn.done;assert.equal(output.status,'completed');
  assert.ok(f.events.some(({event})=>event.type==='message.completed'&&event.payload.text.includes('AIBO_FULL_HISTORY')));
  if(iteration===0){f=await f.restart();opened=await f.invoke('aibo.session.open',{mode:'resume',executionProfile:profile,recovery:output.recovery});assert.ok(opened.capabilities.includes('host-tools'));}
 }
});
for(const name of ['codex','pi']) test(`${name} without a catalog keeps ordinary conversation available`,async t=>{
 const f=await sessionCapability(t,name);
 const opened=await f.invoke('aibo.session.open',{mode:'create',executionProfile:profile});
 assert.ok(!opened.capabilities.includes('host-tools'));
 assert.equal((await f.startTurn('ordinary conversation').done).status,'completed');
});
