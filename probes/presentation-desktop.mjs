import {createServer} from 'vite';
import {mkdir,mkdtemp,writeFile,readFile,rm,cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {buildPresentationSkins} from './lib/build-presentation-skins.mjs';
import {buildPresentation} from '../packages/presentation-tools/build.mjs';
if(process.platform!=='darwin')throw Error('Native Presentation probe currently targets macOS');
const built=await buildPresentationSkins();const root=await mkdtemp(path.join(tmpdir(),'aibo-presentation-native-'));const workspacePath=path.join(root,'workspace');await mkdir(workspacePath);execFileSync('git',['init','-q',workspacePath]);
const upgrade=path.join(root,'upgrade');
execFileSync(process.execPath,[path.join(built.root,'node_modules/@aibo/presentation-shadcn/build.mjs'),upgrade,'0.2.1'],{cwd:built.root,stdio:'pipe'});
const brokenSource=path.join(root,'broken-source');await cp(upgrade,brokenSource,{recursive:true});
await writeFile(path.join(brokenSource,'skin.js'),(await readFile(path.join(brokenSource,'skin.js'),'utf8'))+'\nself.aiboPresentation.render=()=>{throw Error("native_candidate_failure")};\n');
const manifest=JSON.parse(await readFile(path.join(brokenSource,'presentation.json'),'utf8'));manifest.version='0.2.2';await writeFile(path.join(brokenSource,'source.json'),JSON.stringify(manifest));const broken=path.join(root,'broken');await buildPresentation(path.join(brokenSource,'source.json'),broken);
let phase=0,finish,expected=null;
const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false,watch:null},plugins:[{name:'native-presentation-probe',configureServer(server){
 server.middlewares.use('/__presentation_native_config',(_req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({phase,expected,workspacePath,paths:[path.join(built.root,'shadcn'),path.join(built.root,'material3'),upgrade,broken]}));});
 server.middlewares.use('/__presentation_native_report',(req,res)=>{let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{try{finish(JSON.parse(body));res.end('ok');}catch{res.statusCode=400;res.end('invalid report');}});});
}}]});await server.listen();
const identifier=`local.aibo.presentationprobe.${Date.now()}`;const config=path.join(root,'tauri.json');await writeFile(config,JSON.stringify({identifier,productName:'Aibo Presentation isolated probe',build:{beforeDevCommand:'',devUrl:`http://127.0.0.1:${server.httpServer.address().port}`},app:{windows:[{label:'main',title:'Aibo Presentation isolated probe',url:'probes/presentation-desktop.html',width:1280,height:900}]}}));
const evidence=[];let child;
try{
 for(phase=0;phase<2;phase++){
  console.log('NATIVE_PRESENTATION_START '+phase+' '+identifier);
  const report=new Promise(resolve=>finish=resolve);let timer;
  child=spawn('pnpm',['tauri','dev','--no-watch','--config',config],{stdio:['ignore','pipe','pipe'],detached:true});child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);
  try{
   const result=await Promise.race([report,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Native Presentation probe timeout')),240000)),new Promise((_,reject)=>child.on('exit',code=>reject(Error('Tauri exited before report: '+code))))]);
   console.log('NATIVE_PRESENTATION_PHASE '+JSON.stringify(result));evidence.push(result);if(!result.ok)throw Error(result.error);expected=result.selection?{...result.selection,workspaceId:result.workspaceId}:expected;
  }finally{clearTimeout(timer);const exited=new Promise(resolve=>child.once('exit',resolve));try{process.kill(-child.pid,'SIGTERM');}catch{}await exited;child=null;}
 }
 const result={ok:true,platform:process.platform,architecture:process.arch,identifier,evidence,interaction:'scripted native host DOM clicks and real Tauri IPC; physical input and screen reader not claimed'};
 await writeFile('/tmp/aibo-presentation-native-result.json',JSON.stringify(result,null,2)+'\n');console.log('NATIVE_PRESENTATION_RESULT '+JSON.stringify(result));
}finally{if(child)try{process.kill(-child.pid,'SIGTERM');}catch{}await server.close();await built.dispose();await rm(root,{recursive:true,force:true});console.log('Isolated application identifier: '+identifier);}
