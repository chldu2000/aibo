/** Real-provider tool registration/call/restart probe. Uses synthetic history in a temporary workspace. */
import {mkdtemp,mkdir,copyFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {JsonlProcess} from './lib/jsonl-process.mjs';
const name=process.argv[2];
if(!['codex','pi','cursor'].includes(name))throw Error('Usage: node probes/host-tools-native.mjs codex|pi|cursor');
const root=fileURLToPath(new URL('../',import.meta.url));
const directory=await mkdtemp(path.join(tmpdir(),'aibo-native-history-'));
const pkg=path.join(directory,'package'),workspace=path.join(directory,'workspace'),data=path.join(directory,'data');
await Promise.all([pkg,workspace,data].map(value=>mkdir(value)));
const source=name==='cursor'?path.resolve(root,'../aibo-plugins/plugins/cursor'):path.join(root,'src-tauri/capability-plugins',name);
const manifest=JSON.parse(await readFile(path.join(source,'plugin.json')));
if(name==='cursor'){
 const {cp}=await import('node:fs/promises');await cp(source,pkg,{recursive:true});
}else{
 for(const file of ['plugin.json','worker.mjs','engine.mjs'])await copyFile(path.join(source,file),path.join(pkg,file));
 await copyFile(path.join(root,'src-tauri/capability-plugins/session-provider.mjs'),path.join(pkg,'session-provider.mjs'));
}
const catalog=JSON.parse(await readFile(path.join(root,'contracts/host-tools.v1.json')));
const provider=manifest.contributions[0];let client,counter=0,calls=0;const replies=[];
const profile={schema:'aibo.execution-profile/v1',interactionMode:'ask',approvalPolicy:'never',approvalReviewer:'none',filesystemPolicy:'read-only',commandPolicy:'disabled',networkPolicy:name==='cursor'?'agent-managed':'disabled',model:null,reasoningEffort:null};
const identity={instanceId:'probe',generationId:'probe-generation',contributionId:provider.id};
const rpc=async(method,params)=>(await client.requestMessage({jsonrpc:'2.0',method,params},{timeoutMs:180000})).result;
const invoke=async(capability,input,turnId=null)=>{
 const op=provider.operations.find(op=>op.capability.id===capability);
 return (await rpc('capability.invoke',{...identity,invocationId:`probe-${++counter}`,capability,contractVersion:'1.0.0',operationId:op.id,deadlineUnixMs:Date.now()+180000,scope:{kind:'session',id:'probe-session'},context:{turnId,hostTools:catalog,workspaceId:'probe-workspace',workspacePath:workspace,originalCaller:{kind:'window',id:'probe'},permissions:['workspace.read'],callChain:[]},input})).output;
};
async function start(){
 client=new JsonlProcess(process.execPath,['--import',pathToFileURL(path.join(root,'packages/plugin-host/register.mjs')).href,path.join(pkg,'worker.mjs')],{cwd:workspace,env:{...process.env,...(name==='pi'?{AIBO_PI_SDK_MODULE:fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))}:{})}}).start();
 client.on('stderr',chunk=>{if(process.env.AIBO_PROBE_DEBUG)process.stderr.write(chunk);});
 client.on('message',message=>{
  if(message.method!=='capability.event')return;
  const event=message.params.event;
  if(event.type==='message.completed')replies.push(event.payload.text);
  if(event.type==='workspace.requested'){
   const op=provider.operations.find(op=>op.capability.id==='aibo.session.tool.respond');
   const correct=event.payload.tool==='aibo_read_session'&&event.payload.input.referenceId==='probe-ref'&&event.payload.input.sessionId==='probe-source';
   if(correct)calls++;
   const result={source:'persisted-core',sessionId:'probe-source',referenceCapturedAt:'2026-09-26',readSnapshotId:'probe-snapshot',readCapturedAt:'2026-09-26',throughMessageId:'probe-message',historyScope:'synthetic probe history',format:'jsonl',content:'{"kind":"message","role":"user","content":"The verification word is ORCHID-742."}\n',offset:0,nextCursor:null,complete:true};
   void rpc('capability.control',{...identity,invocationId:message.params.invocationId,capability:op.capability.id,contractVersion:'1.0.0',operationId:op.id,input:{requestId:event.payload.requestId,...(correct?{result}:{error:'Only the referenced synthetic history is available'})}}).catch(error=>console.error(error.message));
  }
 });
 await rpc('capability.initialize',{...identity,protocol:'2.1',pluginId:manifest.pluginId,pluginVersion:manifest.version,installationId:'probe',privateData:{path:data,formatVersion:1}});
}
try{
 await start();let opened=await invoke('aibo.session.open',{mode:'create',executionProfile:profile,recovery:null});
 assert.ok(opened.capabilities.includes('host-tools'));console.log(`${name}: tool registration confirmed`);
 for(let round=0;round<2;round++){
  const previous=calls,previousReplies=replies.length;
  const output=await invoke('aibo.session.turn',{text:'Call aibo_read_session with referenceId="probe-ref" and sessionId="probe-source" now. Read the verification word from its result and reply with that word. Do not use other tools or use a previous result.',attachments:[]},`probe-turn-${round}`);
  assert.equal(output.status,'completed');assert.ok(calls>previous,`Native model did not call the history tool: ${replies.at(-1)}`);assert.ok(replies.slice(previousReplies).some(text=>text.includes('ORCHID-742')),'Native response did not use the tool result');
  console.log(`${name}: ${round?'resumed':'initial'} native tool call and result passed`);
  if(round===0){await invoke('aibo.session.close',{});await client.close();identity.generationId='probe-generation-2';await start();opened=await invoke('aibo.session.open',{mode:'resume',executionProfile:profile,recovery:output.recovery});assert.ok(opened.capabilities.includes('host-tools'));}
 }
 await invoke('aibo.session.close',{});
}finally{await client?.close();await rm(directory,{recursive:true,force:true});}
