// Control replacement in the real WKWebView with system input. The isolated frame only accepts
// trusted events, so clicks and keys come from a native helper (CGEvent), not page scripts.
// The probe takes the foreground and moves the pointer while it runs.
import {createServer} from 'vite';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn,execFileSync,execFile} from 'node:child_process';
import {buildPresentationSkins} from './lib/build-presentation-skins.mjs';
if(process.platform!=='darwin')throw Error('Native controls probe currently targets macOS');

const root=await mkdtemp(path.join(tmpdir(),'aibo-controls-native-'));
const helper=path.join(root,'native-input');
execFileSync('swiftc',['-O','probes/native-input.swift','-o',helper],{stdio:'pipe'});
const built=await buildPresentationSkins({surfaces:'controls,semantic'});
const stamp=Date.now(),windowId=`controls-probe-${stamp}`,identifier=`local.aibo.controlsprobe.${stamp}`;
const capability={...JSON.parse(await readFile('src-tauri/capabilities/default.json','utf8')),windows:[windowId]};
let child,finish;
function isolatedPid(){
  const rows=execFileSync('ps',['-axo','pid=,ppid=,comm='],{encoding:'utf8'}).trim().split('\n').map(line=>{
    const [,pid,parent,command]=line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);return {pid:Number(pid),parent:Number(parent),command};
  });
  const descendants=new Set([child.pid]);
  for(let round=0;round<20;round++)for(const row of rows)if(descendants.has(row.parent))descendants.add(row.pid);
  const candidates=rows.filter(row=>descendants.has(row.pid)&&path.basename(row.command)==='aibo');
  if(candidates.length!==1)throw Error('expected exactly one isolated aibo process, found '+candidates.length);
  return candidates[0].pid;
}
const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false,watch:null},plugins:[{name:'controls-native-probe',configureServer(server){
  const json=(res,value)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
  const body=req=>new Promise(resolve=>{let text='';req.on('data',chunk=>text+=chunk);req.on('end',()=>resolve(JSON.parse(text)));});
  server.middlewares.use('/__controls_native_config',(_req,res)=>json(res,{packages:built.packages}));
  server.middlewares.use('/__controls_native_report',async(req,res)=>{finish(await body(req));res.end('ok');});
  server.middlewares.use('/__native_input',async(req,res)=>{
    const step=await body(req);
    const args=step.action==='click'?[String(step.x),String(step.y),String(step.width),String(step.height)]:step.action==='key'?[step.key]:[step.name];
    execFile(helper,[String(isolatedPid()),step.action,...args],{timeout:20000},(error,stdout,stderr)=>json(res,error?{ok:false,error:String(stderr||error)}:{ok:true,output:stdout.trim()}));
  });
}}]});
await server.listen();
const config=path.join(root,'tauri.json');
await writeFile(config,JSON.stringify({identifier,productName:'Aibo controls native probe',build:{beforeDevCommand:'',devUrl:`http://127.0.0.1:${server.httpServer.address().port}`},
  app:{security:{capabilities:[capability]},windows:[{label:windowId,title:'Aibo controls native probe',url:'probes/presentation-controls-native.html',width:1100,height:760}]}}));
try{
  const report=new Promise(resolve=>finish=resolve);let timer;
  child=spawn('pnpm',['tauri','dev','--no-watch','--config',config],{stdio:['ignore','pipe','pipe'],detached:true});
  child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);
  const result=await Promise.race([report,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Native controls probe timeout')),900000)),
    new Promise((_,reject)=>child.on('exit',code=>reject(Error('Tauri exited before report: '+code))))]).finally(()=>clearTimeout(timer));
  console.log('CONTROLS_NATIVE_REPORT '+JSON.stringify(result));
  if(!result.ok)throw Error(result.error);
  const summary={ok:true,platform:process.platform,architecture:process.arch,identifier,packages:built.packages.map(pkg=>pkg.release.manifest.id+'@'+pkg.release.manifest.version),
    checks:result.checks,interaction:'system mouse and keyboard events (CGEvent) and AXPress into the isolated WKWebView; screen reader output not claimed'};
  await writeFile('/tmp/aibo-presentation-controls-native-result.json',JSON.stringify(summary,null,2)+'\n');
  console.log('CONTROLS_NATIVE_RESULT '+JSON.stringify(summary));
}finally{
  if(child){const exited=child.exitCode!==null||child.signalCode!==null?Promise.resolve():new Promise(resolve=>child.once('exit',resolve));try{process.kill(-child.pid,'SIGTERM');}catch{}await exited;}
  await server.close();await built.dispose();await rm(root,{recursive:true,force:true});
  console.log('Isolated application identifier: '+identifier);
}
