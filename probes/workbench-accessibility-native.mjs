import { createServer } from 'vite';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
if(process.platform !== 'darwin') throw Error('macOS native accessibility probe');
const root = await mkdtemp(path.join(tmpdir(),'aibo-native-ax-'));
const workspacePath = path.join(root,'workspace'); await mkdir(workspacePath);
let child, finish; const helpers = new Set();
function isolatedPid() {
  const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,comm='], { encoding: 'utf8' }).trim().split('\n').map(line => {
    const [, pid, parent, command] = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/); return { pid: Number(pid), parent: Number(parent), command };
  });
  const descendants = new Set([child.pid]);
  for (let round = 0; round < 20; round++) for (const row of rows) if (descendants.has(row.parent)) descendants.add(row.pid);
  const candidates = rows.filter(row => descendants.has(row.pid) && path.basename(row.command) === 'aibo');
  if (candidates.length !== 1) throw Error('Cannot identify isolated Aibo process'); return candidates[0].pid;
}
const report = new Promise(resolve => finish = resolve);
const server = await createServer({server:{host:'127.0.0.1',port:0,hmr:false,watch:null},plugins:[{name:'native-ax',configureServer(server){
 server.middlewares.use('/__native_config',(_req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({workspacePath}));});
 server.middlewares.use('/__native_ax',(req,res)=>{
  const helper = spawn('swift',['probes/native-accessibility.swift',String(isolatedPid()), ...(req.url.includes('restore=1') ? ['restore'] : [])]); helpers.add(helper);
  let output='',error=''; helper.stdout.on('data',data=>output+=data); helper.stderr.on('data',data=>error+=data);
  helper.on('exit',code=>{helpers.delete(helper);res.setHeader('Content-Type','application/json');res.statusCode=code===0?200:500;res.end(code===0?output:JSON.stringify({error}));});
 });
 server.middlewares.use('/__native_report',(req,res)=>{let body='';req.on('data',data=>body+=data);req.on('end',()=>{res.end('ok');finish(JSON.parse(body));});});
}}]}); await server.listen();
const identifier=`local.aibo.accessibility.${Date.now()}`, config=path.join(root,'tauri.json');
await writeFile(config,JSON.stringify({identifier,productName:'Aibo isolated accessibility',build:{beforeDevCommand:'',devUrl:`http://127.0.0.1:${server.httpServer.address().port}`},app:{windows:[{label:'main',title:'Aibo accessibility probe',url:'probes/workbench-accessibility-native.html',width:1440,height:1000}]}}));
let timer;
try {
 child=spawn('pnpm',['tauri','dev','--no-watch','--config',config],{stdio:['ignore','pipe','pipe'],detached:true});child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);
 const result=await Promise.race([report,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Native AX probe timeout')),180000)),new Promise((_,reject)=>child.on('exit',code=>reject(Error(`Native exit ${code}`))))]);
 if(!result.ok)throw Error(result.error);
 if(result.results.length!==6 || result.recoveries?.length!==2)throw Error('Expected both skins and three layouts');
 const evidence={identifier,...result};await writeFile('/tmp/aibo-p4-workbench-accessibility-native.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
}finally{clearTimeout(timer);for(const helper of helpers)helper.kill('SIGTERM');try{process.kill(-child.pid,'SIGTERM');}catch{}await server.close();await rm(root,{recursive:true,force:true});}
