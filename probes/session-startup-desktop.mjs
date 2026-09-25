import {createServer} from 'vite';
import {mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {tmpdir} from 'node:os';
if(process.platform!=='darwin')throw Error('Native startup probe currently supports macOS');
const root=await mkdtemp(path.join(tmpdir(),'aibo-startup-native-'));
const workspacePath=path.join(root,'workspace');await mkdir(workspacePath);
const cursorPackage=path.resolve('../aibo-plugins/plugins/cursor');
let finish;const report=new Promise(resolve=>finish=resolve);
const server=await createServer({server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false,watch:null},plugins:[{name:'startup-native',configureServer(vite){
 vite.middlewares.use('/__startup_config',(_req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({workspacePath,cursorPackage}))});
 vite.middlewares.use('/__startup_report',(req,res)=>{let data='';req.on('data',chunk=>data+=chunk);req.on('end',()=>{try{finish(JSON.parse(data));res.end('ok')}catch{res.statusCode=400;res.end('invalid report')}})});
 vite.middlewares.use('/startup-probe.html',(_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><body>Session startup probe<script type="module" src="/probes/session-startup-desktop-client.mjs"></script></body></html>')});
}}]});await server.listen();
const identifier=`local.aibo.startupprobe.${Date.now()}`;
const config=path.join(root,'tauri.json');await writeFile(config,JSON.stringify({identifier,productName:'Aibo startup isolated probe',build:{beforeDevCommand:'',devUrl:`http://127.0.0.1:${server.httpServer.address().port}`},app:{windows:[{label:'main',title:'Aibo startup isolated probe',url:'startup-probe.html',width:1000,height:700}]}}));
const child=spawn('pnpm',['tauri','dev','--no-watch','--config',config],{stdio:['ignore','pipe','pipe'],detached:true});child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);
let timer;
try{
 const result=await Promise.race([report,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Native startup probe timed out')),240000)),new Promise((_,reject)=>child.once('exit',code=>reject(Error(`Tauri exited ${code}`))))]);
 await writeFile('/tmp/aibo-startup-native-result.json',JSON.stringify(result,null,2)+'\n');console.log('STARTUP_NATIVE_RESULT '+JSON.stringify(result));if(!result.ok)process.exitCode=1;
}finally{clearTimeout(timer);try{process.kill(-child.pid,'SIGTERM')}catch{}await server.close();await rm(root,{recursive:true,force:true});console.log('Isolated application identifier: '+identifier)}
