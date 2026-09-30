// Real desktop IPC acceptance, using isolated data and a packaged session provider.
// No model prompts. Usage: node probes/default-session-profile-native.mjs <plugin-directory>
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

assert.ok(process.argv[2], 'Pass a built session plugin directory');
const root = await mkdtemp(path.join(tmpdir(), 'aibo-default-mode-'));
const workspacePath = path.join(root, 'workspace');
await mkdir(workspacePath);
const packagePath = path.resolve(process.argv[2]);
let finish, child, timer;
const report = new Promise(resolve => { finish = resolve; });
const script = `import * as api from '/src/lib/api.ts';
const check=(value,label)=>{if(!value)throw Error(label)};
try {
  const config=await (await fetch('/__default_config')).json();
  let nodeRuntime=null;
  if(config.nodePath){
    const detected=await api.getNodeRuntime(true);
    check(detected.selected?.source==='system','must find local Node without bundled resources');
    const selected=await api.selectNodeRuntime(config.nodePath);
    check(selected.selected?.source==='manual'&&selected.manualPath===config.nodePath,'manual Node must be selected');
    try { await api.selectNodeRuntime(config.workspacePath); throw Error('directory accepted as Node'); }
    catch(error){check(!String(error).includes('directory accepted'),'must reject directory');}
    check((await api.getNodeRuntime(true)).manualPath===config.nodePath,'failed selection must retain previous Node');
    const automatic=await api.selectNodeRuntime(null);
    check(automatic.selected?.source==='system'&&automatic.manualPath===null,'must return to local Node');
    nodeRuntime={local:true,manual:true,invalidPreserved:true,automatic:true,version:automatic.selected.version};
  }
  const workspace=await api.addWorkspace(config.workspacePath);
  await api.setWorkspaceTrust(workspace.id,true);
  const plugin=await api.installAgentPlugin(config.packagePath);
  check(plugin.runnable,'plugin must be runnable: '+JSON.stringify({dependencies:plugin.dependencies,issues:plugin.activationIssues}));
  await api.setAgentPluginEnabled(plugin.id,true);
  const provider=plugin.manifest.contributions.find(entry=>entry.kind==='capabilityProvider'&&entry.scope==='session');
  const pending=await api.createAgentSession(workspace.id,provider.id,plugin.id,null,true);
  check(pending.state==='starting','prepare must return starting');
  const profile=await api.getSessionExecutionProfile(pending.id);
  check(profile.enforced.interactionMode==='plan','default must be declared Plan');
  const ready=await api.resumeAgentSession(pending.id);
  check(ready.state==='idle'&&ready.capabilities.includes('session.create'),'native session must open');
  let parameterScope=null;
  if(config.expectedParameterScope){
    const catalog=await api.getSessionModels(ready.id);
    parameterScope=catalog.parameterScope;
    check(parameterScope===config.expectedParameterScope,'native model projection must preserve parameter scope');
    check(catalog.current&&catalog.models.length,'native model catalog must have a current model');
  }
  await api.closeAgentSession(ready.id);
  await fetch('/__default_report',{method:'POST',body:JSON.stringify({ok:true,pluginVersion:plugin.pluginVersion,mode:profile.enforced.interactionMode,deferred:true,nativeOpen:true,closed:true,parameterScope,nodeRuntime})});
} catch(error) {
  await fetch('/__default_report',{method:'POST',body:JSON.stringify({ok:false,error:String(error)})});
}`;
const server = await createServer({ server: { host:'127.0.0.1', port:0, strictPort:false, hmr:false, watch:null }, plugins:[{
  name:'default-session-profile-probe', configureServer(server) {
    server.middlewares.use('/__default_config', (_req,res) => { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({workspacePath,packagePath,expectedParameterScope:process.env.AIBO_EXPECT_PARAMETER_SCOPE??null,nodePath:process.env.AIBO_VERIFY_NODE_RUNTIME==='1'?process.execPath:null})); });
    server.middlewares.use('/__default_report', (req,res) => { let body=''; req.on('data',chunk=>body+=chunk); req.on('end',()=>{res.end('ok');finish(JSON.parse(body));}); });
    server.middlewares.use('/__default_session', (_req,res) => { res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><body>Default session profile probe<script type="module">'+script+'</script></body></html>'); });
  },
}] });
await server.listen();
const identifier = `local.aibo.defaultmode.${Date.now()}`, configPath = path.join(root,'tauri.json');
await writeFile(configPath,JSON.stringify({ identifier,productName:'Aibo default mode probe',build:{beforeDevCommand:'',devUrl:`http://127.0.0.1:${server.httpServer.address().port}`},app:{windows:[{label:'main',title:'Default mode probe',url:'__default_session'}]} }));
try {
  child=spawn('pnpm',['tauri','dev','--no-watch','--config',configPath],{stdio:['ignore','pipe','pipe'],detached:true});
  child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);
  const result=await Promise.race([report,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Default mode desktop timeout')),180_000);}),new Promise((_,reject)=>child.on('exit',code=>reject(Error(`Native exit ${code}`))))]);
  assert.ok(result.ok,JSON.stringify(result));
  await writeFile('/tmp/aibo-default-session-profile-native.json',JSON.stringify({identifier,...result},null,2)+'\n');
  console.log(JSON.stringify(result));
} finally {
  clearTimeout(timer);
  if(child)try{process.kill(-child.pid,'SIGTERM');}catch{}
  await server.close();await rm(root,{recursive:true,force:true});
}
