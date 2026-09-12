import { createServer } from 'vite';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { buildExternalPlugin } from './build-external-plugin.mjs';
if(process.platform!=='darwin')throw Error('This native acceptance currently verifies macOS');
const built=await buildExternalPlugin();
const workspacePath=path.join(built.root,'workspace');await mkdir(workspacePath);
let finish,child,timer;
const report=new Promise(resolve=>finish=resolve);
const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false,watch:null},plugins:[{name:'external-sdk',configureServer(server){
  server.middlewares.use('/__external_config',(_req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({workspacePath,packagePath:built.packagePath}));});
  server.middlewares.use('/__external_report',(req,res)=>{let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{res.end('ok');finish(JSON.parse(body));});});
}}]});await server.listen();
const identifier=`local.aibo.externalsdk.${Date.now()}`,config=path.join(built.root,'tauri.json');
await writeFile(config,JSON.stringify({identifier,productName:'Aibo external SDK verification',build:{beforeDevCommand:'',devUrl:`http://127.0.0.1:${server.httpServer.address().port}`},app:{windows:[{label:'main',title:'External SDK verification',url:'probes/external-plugin-native.html',width:1440,height:1000}]}}));
try {
  child=spawn('pnpm',['tauri','dev','--no-watch','--config',config],{stdio:['ignore','pipe','pipe'],detached:true});child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);
  const result=await Promise.race([report,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('External SDK native timeout')),180000)),new Promise((_,reject)=>child.on('exit',code=>reject(Error(`Native exit ${code}`))))]);
  if(!result.ok)throw Error(JSON.stringify(result));
  if(result.skins.length!==2)throw Error('Both skins required');
  const evidence={identifier,platform:process.platform,build:built.evidence,...result};
  await writeFile('/tmp/aibo-p5-external-plugin-native.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
} finally {clearTimeout(timer);if(child)try{process.kill(-child.pid,'SIGTERM');}catch{}await server.close();await rm(built.root,{recursive:true,force:true});}
