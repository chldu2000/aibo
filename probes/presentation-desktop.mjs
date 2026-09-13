import {createServer} from 'vite';
import {mkdir,mkdtemp,writeFile,readFile,rm,cp,unlink,lstat} from 'node:fs/promises';
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
const runtimeSource=path.join(root,'runtime-source');await cp(upgrade,runtimeSource,{recursive:true});
await writeFile(path.join(runtimeSource,'skin.js'),(await readFile(path.join(runtimeSource,'skin.js'),'utf8'))+'\nconst nativeRender=self.aiboPresentation.render;let nativeFaultScheduled=false;self.aiboPresentation.render=input=>{const tree=nativeRender(input);if(input.surface==="workbench"&&!nativeFaultScheduled){nativeFaultScheduled=true;setTimeout(()=>{while(true){}},4000);}return tree;};\n');
const runtimeManifest=JSON.parse(await readFile(path.join(runtimeSource,'presentation.json'),'utf8'));runtimeManifest.version='0.2.3';await writeFile(path.join(runtimeSource,'source.json'),JSON.stringify(runtimeManifest));const runtimeFault=path.join(root,'runtime-fault');await buildPresentation(path.join(runtimeSource,'source.json'),runtimeFault);
const probeWindowId=`presentation-probe-${Date.now()}`;
const probeCapability={...JSON.parse(await readFile('src-tauri/capabilities/default.json','utf8')),windows:[probeWindowId]};
let phase=0,finish,expected=null;
const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false,watch:null},plugins:[{name:'native-presentation-probe',configureServer(server){
 server.middlewares.use('/__presentation_native_config',(_req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({phase,expected,workspacePath,probeWindowId,runtimeFault,paths:[path.join(built.root,'shadcn'),path.join(built.root,'material3'),upgrade,broken]}));});
 server.middlewares.use('/__presentation_native_report',(req,res)=>{let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{try{finish(JSON.parse(body));res.end('ok');}catch{res.statusCode=400;res.end('invalid report');}});});
}}]});await server.listen();
const identifier=`local.aibo.presentationprobe.${Date.now()}`;const config=path.join(root,'tauri.json');await writeFile(config,JSON.stringify({identifier,productName:'Aibo Presentation isolated probe',build:{beforeDevCommand:'',devUrl:`http://127.0.0.1:${server.httpServer.address().port}`},app:{security:{capabilities:[probeCapability]},windows:[{label:probeWindowId,title:'Aibo Presentation isolated probe',url:'probes/presentation-desktop.html',width:1280,height:900}]}}));
const evidence=[];let child,repair;
try{
 for(phase=0;phase<4;phase++){
  console.log('NATIVE_PRESENTATION_START '+phase+' '+identifier);
  const report=new Promise(resolve=>finish=resolve);let timer;
  child=spawn('pnpm',['tauri','dev','--no-watch','--config',config],{stdio:['ignore','pipe','pipe'],detached:true});child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);
  try{
   const result=await Promise.race([report,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Native Presentation probe timeout')),240000)),new Promise((_,reject)=>child.on('exit',code=>reject(Error('Tauri exited before report: '+code))))]);
   console.log('NATIVE_PRESENTATION_PHASE '+JSON.stringify(result));evidence.push(result);if(!result.ok)throw Error(result.error);expected=result.selection?{...result.selection,workspaceId:result.workspaceId,layout:result.layout,dataPath:result.dataPath}:expected;
  }finally{clearTimeout(timer);const exited=child.exitCode!==null||child.signalCode!==null?Promise.resolve():new Promise(resolve=>child.once('exit',resolve));try{process.kill(-child.pid,'SIGTERM');}catch{}await exited;child=null;}
  if(repair){await writeFile(repair.file,repair.bytes);repair=null;}
  if(phase===1||phase===2){
   if(path.basename(path.resolve(expected.dataPath??''))!==identifier||!/^[a-f0-9]{64}$/.test(expected.digest))throw Error('unsafe_native_fault_target');
   const file=path.join(expected.dataPath,'presentation-packages',expected.digest,phase===1?'presentation.json':'skin.js');
   if(!(await lstat(file)).isFile())throw Error('unsafe_native_fault_resource');
   repair={file,bytes:await readFile(file)};
   if(phase===1)await unlink(file);else await writeFile(file,Buffer.concat([repair.bytes,Buffer.from('\n// probe-only integrity corruption\n')]));
  }
 }
 const result={ok:true,platform:process.platform,architecture:process.arch,identifier,windowId:probeWindowId,evidence,interaction:'scripted native host DOM clicks and real Tauri IPC; physical input and screen reader not claimed'};
 await writeFile('/tmp/aibo-presentation-native-result.json',JSON.stringify(result,null,2)+'\n');console.log('NATIVE_PRESENTATION_RESULT '+JSON.stringify(result));
}finally{if(child)try{process.kill(-child.pid,'SIGTERM');}catch{}if(repair)await writeFile(repair.file,repair.bytes);await server.close();await built.dispose();await rm(root,{recursive:true,force:true});console.log('Isolated application identifier: '+identifier);}
