import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { mkdtemp, mkdir, writeFile, readFile, cp, rm, stat } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
if(process.platform!=='darwin')throw Error('Native lifecycle probe supports macOS');
const root=await mkdtemp(path.join(tmpdir(),'aibo-lifecycle-'));
const workspacePath=path.join(root,'workspace');await mkdir(workspacePath);
const upgradePath=path.join(root,'upgrade'),downgradePath=path.join(root,'downgrade');
for(const [directory,version] of [[upgradePath,'99.0.0'],[downgradePath,'0.0.0']]) {
  await cp(path.resolve('fixtures/plugins/capability-echo'),directory,{recursive:true});
  const manifest=JSON.parse(await readFile(path.join(directory,'plugin.json'),'utf8'));manifest.version=version;
  await writeFile(path.join(directory,'plugin.json'),JSON.stringify(manifest));
}
const identifier=`local.aibo.lifecycleprobe.${Date.now()}`;
const data=path.join(homedir(),'Library','Application Support',identifier,'development');
let finish,child,timer;
const report=new Promise(resolve=>{finish=resolve;});
const server=await createServer({server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false,watch:null},plugins:[{name:'lifecycle-report',configureServer(server){
  server.middlewares.use('/__plugin_lifecycle_config',(_req,res)=>res.end(JSON.stringify({workspacePath,upgradePath,downgradePath,packagePath:path.resolve('fixtures/plugins/capability-echo')})));
  server.middlewares.use('/__plugin_lifecycle_report',(req,res)=>{let text='';req.on('data',chunk=>text+=chunk);req.on('end',()=>{finish(JSON.parse(text));res.end('ok');});});
}}]});
try {
  await server.listen();
  const config=path.join(root,'tauri.json');
  await writeFile(config,JSON.stringify({identifier,productName:'Aibo lifecycle isolated probe',build:{beforeDevCommand:'',devUrl:`http://127.0.0.1:${server.httpServer.address().port}`},app:{windows:[{label:'main',title:'Aibo lifecycle isolated probe',url:'probes/plugin-lifecycle-desktop.html',width:960,height:720}]}}));
  child=spawn('pnpm',['tauri','dev','--no-watch','--config',config],{stdio:['ignore','pipe','pipe'],detached:true});
  child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);
  const result=await Promise.race([report,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Native probe timed out')),180000);}),new Promise((_,reject)=>child.on('exit',code=>reject(Error(`Tauri exited: ${code}`))))]);
  assert.equal(result.ok,true,JSON.stringify(result));
  for(const location of [path.join(data,'plugins',result.installationId),path.join(data,'plugin-data',result.pluginId,result.installationId)]) {
    await assert.rejects(stat(location),error=>error.code==='ENOENT');
  }
  const history=execFileSync('python3',['-c',`import sqlite3,sys
c=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True)
assert c.execute('select status from capability_invocations where id=?',(sys.argv[2],)).fetchone()[0]=='completed'
assert c.execute('select count(*) from capability_provider_bindings where installation_id=?',(sys.argv[3],)).fetchone()[0]==0
print('invocation history retained; provider bindings removed')`,path.join(data,'aibo.sqlite3'),result.invocationId,result.installationId],{encoding:'utf8'});
  console.log('NATIVE_PLUGIN_LIFECYCLE_RESULT '+JSON.stringify({...result,filesRemoved:true,history:history.trim()}));
} finally {
  clearTimeout(timer);if(child)try{process.kill(-child.pid,'SIGTERM');}catch{}
  await server.close();await rm(root,{recursive:true,force:true});
  console.log('Isolated application identifier: '+identifier);
}
