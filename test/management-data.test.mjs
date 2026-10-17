import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import Ajv from 'ajv';
import {createManagementDataController} from '../src/lib/app/management-data-controller.ts';
import {createManagementReader} from '../src-tauri/capability-plugins/codex/management.mjs';
const target=sectionId=>({installationId:'example',panelId:'example.panel',sectionId});
const request=sectionId=>({scope:{kind:'application'},input:{sectionId}});
const valid=new Ajv({strict:false}).compile(JSON.parse(await readFile('contracts/management-data.v1.schema.json','utf8')));
function reader(mode,timeoutMs=3000){
  const children=[];
  return {children,read:createManagementReader({timeoutMs,launch:()=>({command:process.execPath,prefix:['fixtures/plugins/codex/fake-management.mjs',mode],shell:false}),start:(command,args,options)=>{
    // The fixture runs in the repository; production uses the home directory.
    const child=spawn(command,args,{...options,cwd:process.cwd()});children.push(child);return child;
  }})};
}
test('management switches and close discard late responses and clear account data',async()=>{
  const pending=[];let state;
  const controller=createManagementDataController({read:t=>new Promise((resolve,reject)=>pending.push({t,resolve,reject})),changed:s=>state=s});
  controller.select(target('account'));controller.select(target('usage'));
  pending[0].resolve({secret:'old'});await Promise.resolve();assert.equal(state.data,null);
  pending[1].resolve({message:'current'});await Promise.resolve();assert.equal(state.data.message,'current');
  const refresh=controller.refresh();assert.equal(state.data,null);
  controller.select(null);pending[2].reject(Error('secret error'));await refresh;
  assert.deepEqual(state,{target:null,data:null,loading:false,failed:false});
});
test('read failures expose only generic state and refresh can recover',async()=>{
  let state,fail=true;const controller=createManagementDataController({read:async()=>{if(fail)throw Error('SECRET');return {state:'ready'};},changed:s=>state=s});
  controller.select(target('account'));await new Promise(resolve=>setImmediate(resolve));assert.equal(state.failed,true);assert.equal(JSON.stringify(state).includes('SECRET'),false);
  fail=false;await controller.refresh();assert.equal(state.failed,false);assert.equal(state.data.state,'ready');
});
test('Codex management projects only account facts and bounded rate windows, then closes its child',async()=>{
  const {read,children}=reader('ready');
  for(const section of ['account','usage']){
    const data=await read(request(section),{signal:new AbortController().signal});
    assert.equal(valid(data),true,JSON.stringify(valid.errors));assert.equal(JSON.stringify(data).includes('SECRET'),false);
    if(section==='account')assert.equal(data.properties.find(p=>p.key==='email').value,'person@example.test');
    else assert.equal(data.metrics[0].value,35);
  }
  assert.ok(children.every(child=>child.exitCode!==null || child.signalCode!==null));
});
test('signed-out usage is unavailable without calling rate limits',async()=>{
  const {read}=reader('signed-out');const data=await read(request('usage'),{signal:new AbortController().signal});
  assert.equal(data.state,'unavailable');assert.deepEqual(data.metrics,[]);
});
test('errors, deadlines, cancellation and missing executable release the child without raw diagnostics',async()=>{
  for(const mode of ['error','hang']){
    const {read,children}=reader(mode,100);await assert.rejects(read(request('account'),{signal:new AbortController().signal}),error=>!error.message.includes('SECRET'));
    assert.ok(children.every(child=>child.exitCode!==null || child.signalCode!==null));
  }
  const {read,children}=reader('hang');const abort=new AbortController();const pending=read(request('account'),{signal:abort.signal});abort.abort();await assert.rejects(pending);
  assert.ok(children.every(child=>child.exitCode!==null || child.signalCode!==null));
  const missing=createManagementReader({launch:()=>({command:'/missing/aibo-test-codex',prefix:[],shell:false})});await assert.rejects(missing(request('account'),{signal:new AbortController().signal}));
});

test('packaged Codex worker negotiates and serves the application management provider',async t=>{
  const {sessionCapability}=await import('./helpers/session-capability.mjs');
  const provider=await sessionCapability(t,'codex',{},undefined,'dev.aibo.codex.management-data');
  const account=await provider.invoke('dev.aibo.codex.management.read',{sectionId:'account'},null,[]);
  assert.equal(account.properties.find(p=>p.key==='email').value,'person@example.test');
  const usage=await provider.invoke('dev.aibo.codex.management.read',{sectionId:'usage'},null,[]);
  assert.deepEqual(usage.metrics.map(m=>m.value),[20,40]);
});
