import { createServer } from 'vite';
import { mkdir, mkdtemp, writeFile, rm, copyFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
if(process.platform!=='darwin')throw Error('Native search probe currently validated on macOS only');
const root=await mkdtemp(path.join(tmpdir(),'aibo-search-native-'));
const workspacePath=path.join(root,'workspace');await mkdir(workspacePath);
execFileSync('git',['init','-q',workspacePath]);await writeFile(path.join(workspacePath,'one.txt'),'AIBO_NATIVE_SEARCH_OK\n原生全局搜索正文\n');
await writeFile(path.join(workspacePath,'.gitignore'),'ignored.txt\n');
await writeFile(path.join(workspacePath,'ignored.txt'),'AIBO_IGNORED_SEARCH_TEXT\n');
let finish;
const report=new Promise(resolve=>finish=resolve);
const server=await createServer({server:{host:'127.0.0.1',port:0,strictPort:false},plugins:[{name:'isolated-native-probe',configureServer(server){
  server.middlewares.use('/__search_native_config',(_req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({workspacePath}));});
  server.middlewares.use('/__search_native_report',(req,res)=>{let text='';req.on('data',chunk=>text+=chunk);req.on('end',()=>{try{finish(JSON.parse(text));res.end('ok');}catch{res.statusCode=400;res.end('bad report');}});});
}}]});await server.listen();
const port=server.httpServer.address().port;
// A unique identifier isolates application data from the user's Aibo installation.
const identifier=`local.aibo.searchprobe.${Date.now()}`;
// Optional closed, checkpointed fixture exercises the real desktop upgrade path.
if(process.env.AIBO_SEARCH_PROBE_DB){
  const dataDir=path.join(homedir(),'Library','Application Support',identifier);
  await mkdir(dataDir,{recursive:true});
  await copyFile(process.env.AIBO_SEARCH_PROBE_DB,path.join(dataDir,'aibo.sqlite3'));
}
const config=path.join(root,'tauri.json');await writeFile(config,JSON.stringify({identifier,productName:'Aibo Search isolated probe',build:{beforeDevCommand:'',devUrl:`http://127.0.0.1:${port}`},app:{windows:[{label:'main',title:'Aibo Search isolated probe',url:'probes/search-desktop.html',width:1280,height:900}]}}));
const child=spawn('pnpm',['tauri','dev','--no-watch','--config',config],{stdio:['ignore','pipe','pipe'],detached:true});
child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);
let timer;
try {
  const result=await Promise.race([report,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Native probe timed out')),180_000)),new Promise((_,reject)=>child.on('exit',code=>reject(Error(`Tauri exited before report: ${code}`))))]);
  console.log('NATIVE_SEARCH_RESULT '+JSON.stringify(result));
  await writeFile('/tmp/aibo-search-native-result.json',JSON.stringify(result,null,2)+'\n');
  if(!result.ok)process.exitCode=1;
} finally {
  clearTimeout(timer);try{process.kill(-child.pid,'SIGTERM');}catch{}
  await server.close();await rm(root,{recursive:true,force:true});
  // Retain the isolated app data path in the report rather than deleting an assumed OS path.
  console.log('Isolated application identifier: '+identifier);
}
