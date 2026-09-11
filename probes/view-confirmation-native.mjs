import { createServer } from 'vite';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
if (process.platform !== 'darwin') throw Error('Native dialog automation requires macOS and Accessibility permission');
const root = await mkdtemp(path.join(tmpdir(),'aibo-view-dialog-'));
const workspacePath=path.join(root,'workspace'), packagePath=path.join(root,'echo');
await mkdir(workspacePath);
execFileSync('git',['init','-q',workspacePath]);
execFileSync(process.execPath,['probes/build-echo-plugin.mjs',packagePath]);
const executable=path.join(packagePath,'echo-agent.mjs');
await writeFile(executable,(await readFile(executable,'utf8')).replaceAll("confirmation: 'never'", "confirmation: 'always'"));
let child, finish;
const report = new Promise(resolve => { finish=resolve; });
const clicks=[];
const helpers=new Set();
function isolatedPid() {
  const rows=execFileSync('ps',['-axo','pid=,ppid=,comm='],{encoding:'utf8'}).trim().split('\n').map(line=>{const [,pid,parent,command]=line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);return {pid:Number(pid),parent:Number(parent),command};});
  const descendants=new Set([child.pid]);
  for(let round=0;round<20;round++) for(const row of rows)if(descendants.has(row.parent))descendants.add(row.pid);
  const candidates=rows.filter(row=>descendants.has(row.pid)&&path.basename(row.command)==='aibo');
  if(candidates.length!==1)throw Error('Cannot uniquely identify isolated Aibo process');
  return candidates[0].pid;
}
const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false,watch:null},plugins:[{name:'native-view-dialog',configureServer(server){
  server.middlewares.use('/__dialog_progress',(req,res)=>{let body='';req.on('data',data=>body+=data);req.on('end',()=>{console.log('DIALOG_PROGRESS '+body);res.end('ok');});});
  server.middlewares.use('/__dialog_config',(_req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({workspacePath,packagePath}));});
  server.middlewares.use('/__dialog_report',(req,res)=>{let body='';req.on('data',data=>body+=data);req.on('end',()=>{res.end('ok');finish(JSON.parse(body));});});
  server.middlewares.use('/__dialog_ready',(req,res)=>{let body='';req.on('data',data=>body+=data);req.on('end',()=>{
    try { const {marker,decision}=JSON.parse(body); const helper=spawn('swift',['probes/native-dialog-click.swift',String(isolatedPid()),marker,decision],{stdio:['ignore','pipe','pipe']});
      helpers.add(helper);helper.on('exit',()=>helpers.delete(helper));
      const pending=new Promise((resolve,reject)=>{let output='';helper.stdout.on('data',data=>output+=data);helper.stderr.on('data',data=>output+=data);helper.on('error',reject);helper.on('exit',code=>code===0?resolve(output.trim()):reject(Error(output)));});
      clicks.push(pending);pending.catch(error=>finish({ok:false,error:String(error)}));res.end('ok');
    }catch(error){res.statusCode=500;res.end(String(error));finish({ok:false,error:String(error)});}
  });});
}}]});await server.listen();
const config=path.join(root,'tauri.json');
await writeFile(config,JSON.stringify({identifier:`local.aibo.viewdialog.${Date.now()}`,productName:'Aibo isolated view dialog',build:{beforeDevCommand:'',devUrl:`http://127.0.0.1:${server.httpServer.address().port}`},app:{windows:[{label:'main',title:'Isolated view confirmation',url:'probes/view-confirmation-native.html',width:900,height:600}]}}));
let timer;
try {
  child=spawn('pnpm',['tauri','dev','--no-watch','--config',config],{stdio:['ignore','pipe','pipe'],detached:true});child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);
  const result=await Promise.race([report,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Native dialog probe timeout')),120000)),new Promise((_,reject)=>child.on('exit',code=>reject(Error('Native exit '+code))))]);
  if(!result.ok)throw Error(result.error);
  const nativeClicks=await Promise.all(clicks);
  if(nativeClicks.length!==2)throw Error('Both native decisions must be verified');
  const evidence={...result,nativeClicks};
  await writeFile('/tmp/aibo-p4-view-dialog-result.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
}finally{clearTimeout(timer);for(const helper of helpers)helper.kill('SIGTERM');if(child)try{process.kill(-child.pid,'SIGTERM');}catch{}await server.close();await rm(root,{recursive:true,force:true});}
