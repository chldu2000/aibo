import { createServer } from 'vite';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
if(process.platform!=='darwin')throw Error('Native semantic probe currently validated on macOS only');
const root=await mkdtemp(path.join(tmpdir(),'aibo-p1-native-'));
const workspacePath=path.join(root,'workspace');await mkdir(workspacePath);
execFileSync('git',['init','-q',workspacePath]);await writeFile(path.join(workspacePath,'one.txt'),'AIBO_NATIVE_SEMANTIC_OK\n');
let finish;
const report=new Promise(resolve=>finish=resolve);
const server=await createServer({server:{host:'127.0.0.1',port:0,strictPort:false},plugins:[{name:'isolated-native-probe',configureServer(server){
  server.middlewares.use('/__semantic_native_config',(_req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({workspacePath}));});
  server.middlewares.use('/__semantic_native_report',(req,res)=>{let text='';req.on('data',chunk=>text+=chunk);req.on('end',()=>{try{finish(JSON.parse(text));res.end('ok');}catch{res.statusCode=400;res.end('bad report');}});});
}}]});await server.listen();
const port=server.httpServer.address().port;
// A unique identifier isolates application data from the user's Aibo installation.
const identifier=`local.aibo.p1probe.${Date.now()}`;
const config=path.join(root,'tauri.json');await writeFile(config,JSON.stringify({identifier,productName:'Aibo P1 isolated probe',build:{beforeDevCommand:'',devUrl:`http://127.0.0.1:${port}`},app:{windows:[{label:'main',title:'Aibo P1 isolated probe',url:'probes/semantic-desktop.html',width:1280,height:900}]}}));
const child=spawn('pnpm',['tauri','dev','--no-watch','--config',config],{stdio:['ignore','pipe','pipe'],detached:true});
child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);
let timer;
try {
  const result=await Promise.race([report,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Native probe timed out')),180_000)),new Promise((_,reject)=>child.on('exit',code=>reject(Error(`Tauri exited before report: ${code}`))))]);
  console.log('NATIVE_SEMANTIC_RESULT '+JSON.stringify(result));
  await writeFile('/tmp/aibo-p1-native-result.json',JSON.stringify(result,null,2)+'\n');
  if(!result.ok)process.exitCode=1;
} finally {
  clearTimeout(timer);try{process.kill(-child.pid,'SIGTERM');}catch{}
  await server.close();await rm(root,{recursive:true,force:true});
  // Retain the isolated app data path in the report rather than deleting an assumed OS path.
  console.log('Isolated application identifier: '+identifier);
}
