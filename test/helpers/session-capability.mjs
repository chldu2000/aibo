import {chmod,copyFile,mkdir,mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {JsonlProcess} from '../../probes/lib/jsonl-process.mjs';
import Ajv from 'ajv/dist/2020.js';

let generation=0;
export async function sessionCapability(t,name,extraEnv={},existingDirectory,contributionId,hostTools) {
  const directory=existingDirectory ?? await mkdtemp(path.join(tmpdir(),`aibo-${name}-capability-`));
  const pkg=path.join(directory,'package');await mkdir(pkg,{recursive:true});
  const data=path.join(directory,'data');await mkdir(data,{recursive:true});
  for (const file of ['engine.mjs','worker.mjs','plugin.json']) await copyFile(`src-tauri/capability-plugins/${name}/${file}`,path.join(pkg,file));
  await copyFile('src-tauri/capability-plugins/session-provider.mjs',path.join(pkg,'session-provider.mjs'));
  if (name==='codex') {
    await copyFile('fixtures/plugins/codex/fake-codex.mjs',path.join(directory,'codex'));await chmod(path.join(directory,'codex'),0o755);
  }
  const manifest=JSON.parse(await readFile(path.join(pkg,'plugin.json'),'utf8'));
  const contribution=contributionId ? manifest.contributions.find(item=>item.id===contributionId) : manifest.contributions[0];
  const ajv=new Ajv({strict:false});
  const validators=new Map(contribution.operations.map(op=>[op.capability.id,ajv.compile(op.outputSchema)]));
  function output(capability,result) {
    const validate=validators.get(capability);
    if(!validate(result))throw Error(`Invalid ${capability} output: ${JSON.stringify(validate.errors)}`);
    return result;
  }
  const client=new JsonlProcess(process.execPath,['--import',pathToFileURL(path.resolve('packages/plugin-host/register.mjs')).href,path.join(pkg,'worker.mjs')],{cwd:directory,env:{...process.env,PATH:`${directory}${path.delimiter}${process.env.PATH}`,AIBO_PI_SDK_MODULE:path.resolve('fixtures/pi/fake-sdk.mjs'),...extraEnv}}).start();
  t.after(async()=>{await client.close();if(!existingDirectory)await rm(directory,{recursive:true,force:true});});
  const events=[],frames=[];let counter=0;
  client.on('message',message=>{frames.push(message);if(message.method==='capability.event')events.push(message.params);});
  let stderr='';client.on('stderr',chunk=>stderr+=chunk);
  const rpc=async(method,params)=>(await client.requestMessage({jsonrpc:'2.0',method,params})).result;
  const identity={instanceId:'instance',generationId:`generation-${++generation}`,contributionId:contribution.id};
  await rpc('capability.initialize',{...identity,protocol:'2.1',pluginId:manifest.pluginId,pluginVersion:manifest.version,installationId:'installation',privateData:{path:data,formatVersion:1}});
  function request(capability,input,turnId=null,permissions=['workspace.read']) {
    const operation=contribution.operations.find(op=>op.capability.id===capability);
    if(!operation)throw Error(`Undeclared test capability: ${capability}`);
    return {...identity,invocationId:`invocation-${++counter}`,capability,contractVersion:'1.0.0',operationId:operation.id,deadlineUnixMs:Date.now()+15000,scope:{kind:contribution.scope,id:contribution.scope==='session'?'session':'workspace'},context:{...(hostTools?{hostTools}:{}),turnId,workspaceId:'workspace',workspacePath:directory,originalCaller:{kind:'window',id:'main'},permissions,callChain:[]},input};
  }
  async function invoke(capability,input={},turnId=null,permissions) {
    try{return output(capability,(await rpc('capability.invoke',request(capability,input,turnId,permissions))).output);}
    catch(error){throw new Error(`${error.message}\n${stderr}`,{cause:error});}
  }
  function startTurn(text,turnId='turn',capability='aibo.session.turn',permissions) {
    const p=request(capability,{text,attachments:[]},turnId,permissions);
    return {request:p,done:rpc('capability.invoke',p).then(result=>output(capability,result.output))};
  }
  async function control(turn,capability,input={}) {
    const p=request(capability,input);
    return output(capability,(await rpc('capability.control',{...identity,invocationId:turn.request.invocationId,capability,contractVersion:p.contractVersion,operationId:p.operationId,input})).output);
  }
  const wait=type=>client.waitFor(message=>message.method==='capability.event'&&message.params.event.type===type).then(message=>message.params.event);
  const restart=async()=>{await client.close();return sessionCapability(t,name,extraEnv,directory,contributionId,hostTools);};
  return {directory,data,manifest,client,frames,events,invoke,startTurn,control,wait,request,rpc,restart,identity};
}
