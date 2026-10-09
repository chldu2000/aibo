import {createServer} from 'vite';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
const root=await mkdtemp(path.join(tmpdir(),'aibo-terminal-native-'));const workspacePath=path.join(root,'workspace');await mkdir(workspacePath);
let complete;const report=new Promise(resolve=>complete=resolve);let child,timer;
const server=await createServer({server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false,watch:null},plugins:[{name:'tool-config',configureServer(server){server.middlewares.use('/__tool_config',(_req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({workspacePath,packagePath:path.resolve('../aibo-plugins/dist/terminal')}));});server.middlewares.use('/__tool_report',(req,res)=>{let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{res.end('ok');complete(JSON.parse(body));});});}}]});await server.listen();
const identifier=`local.aibo.toolprobe.${Date.now()}`;const config=path.join(root,'tauri.json');await writeFile(config,JSON.stringify({identifier,productName:'Aibo terminal verification',build:{beforeDevCommand:'',devUrl:`http://127.0.0.1:${server.httpServer.address().port}`},app:{windows:[{label:'main',title:'Aibo terminal verification',url:'probes/tool-view-native.html',width:1440,height:1000}]}}));
try {
 child=spawn('pnpm',['tauri','dev','--no-watch','--config',config],{stdio:['ignore','pipe','pipe'],detached:true});child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);
 const result=await Promise.race([report,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Native terminal probe deadline')),240000)),new Promise((_,reject)=>child.on('exit',code=>reject(Error(`Native exited ${code}`))))]);
 await writeFile('/tmp/aibo-terminal-native.json',JSON.stringify({identifier,...result},null,2));if(!result.ok)throw Error(JSON.stringify(result));console.log(JSON.stringify(result));
}finally{clearTimeout(timer);if(child)try{process.kill(-child.pid,'SIGTERM');}catch{}await server.close();await rm(root,{recursive:true,force:true});}
