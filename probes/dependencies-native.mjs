import { createServer } from 'vite';
import { mkdtemp,mkdir,writeFile,readFile,cp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
const root=await mkdtemp(path.join(tmpdir(),'aibo-dependencies-native-'));
const workspacePath=path.join(root,'workspace'),childPath=path.join(root,'child'),newerPath=path.join(root,'newer'),parentPath=path.join(root,'parent');
await mkdir(workspacePath);
for(const directory of [childPath,newerPath,parentPath])await cp('fixtures/plugins/capability-echo',directory,{recursive:true});
const newer=JSON.parse(await readFile(path.join(newerPath,'plugin.json'),'utf8'));newer.version='1.1.0';await writeFile(path.join(newerPath,'plugin.json'),JSON.stringify(newer));
const parent=JSON.parse(await readFile('fixtures/plugins/platform-v2/dependent.json','utf8'));for(const contribution of parent.contributions)for(const operation of contribution.operations)operation.timeoutMs=3000;await writeFile(path.join(parentPath,'plugin.json'),JSON.stringify(parent));
let stage=0,saved={},finish;
const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false,watch:null},plugins:[{name:'dependencies-native',configureServer(server){
  server.middlewares.use('/__dep_config',(_req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({stage,saved,workspacePath,childPath,newerPath,parentPath}));});
  server.middlewares.use('/__dep_report',(req,res)=>{let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{res.end('ok');finish(JSON.parse(body));});});
}}]});await server.listen();
const identifier=`local.aibo.dependencyprobe.${Date.now()}`,config=path.join(root,'tauri.json');
await writeFile(config,JSON.stringify({identifier,productName:'Aibo isolated capability probe',build:{beforeDevCommand:'',devUrl:`http://127.0.0.1:${server.httpServer.address().port}`},app:{windows:[{label:'main',title:'Capability verification',url:'probes/dependencies-native.html',width:900,height:500}]}}));
const results=[];
try {
  for(stage=0;stage<2;stage++) {
    const report=new Promise(resolve=>finish=resolve);
    const child=spawn('pnpm',['tauri','dev','--no-watch','--config',config],{stdio:['ignore','pipe','pipe'],detached:true});child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);
    let timer;try {
      const result=await Promise.race([report,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Capability native timeout')),180000)),new Promise((_,reject)=>child.on('exit',code=>reject(Error(`Native exit ${code}`))))]);
      results.push(result);console.log('DEPENDENCIES_NATIVE_RESULT '+JSON.stringify(result));if(!result.ok)throw Error(result.error);saved=result.saved;
    }finally{clearTimeout(timer);try{process.kill(-child.pid,'SIGTERM');}catch{}await new Promise(resolve=>setTimeout(resolve,1500));}
  }
}finally{await writeFile('/tmp/aibo-p3-dependencies-native.json',JSON.stringify({identifier,results},null,2)+'\n');await server.close();await rm(root,{recursive:true,force:true});}
