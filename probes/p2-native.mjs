import { createServer } from 'vite';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
const root = await mkdtemp(path.join(tmpdir(), 'aibo-p2-native-'));
const workspacePath = path.join(root, 'workspace'); await mkdir(workspacePath);
execFileSync('git', ['init', '-q', workspacePath]);
await writeFile(path.join(workspacePath, 'one.txt'), 'P2 native fixture\n');
execFileSync('git',['-C',workspacePath,'add','one.txt']);
const packagePath = path.join(root, 'echo');
execFileSync(process.execPath, ['probes/build-echo-plugin.mjs', packagePath]);
const identifier = `local.aibo.p2probe.${Date.now()}`;
let stage = 0, saved = {}, finish, secondary = null;
const server = await createServer({ server: { host: '127.0.0.1', port: 0, hmr: false, watch: null }, plugins: [{ name: 'p2-native', configureServer(server) {
  server.middlewares.use('/__p2_config', (_req, res) => { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({ stage, saved, workspacePath, packagePath, secondary })); });
  server.middlewares.use('/__p2_secondary', (req, res) => { let body='';req.on('data', chunk=>body+=chunk);req.on('end',()=>{secondary=JSON.parse(body);res.end('ok');}); });
  server.middlewares.use('/__p2_report', (req, res) => { let body=''; req.on('data', chunk => body+=chunk); req.on('end', () => { res.end('ok'); finish(JSON.parse(body)); }); });
} }] }); await server.listen();
const config = path.join(root, 'tauri.json');
await writeFile(config, JSON.stringify({ identifier, productName: 'Aibo P2 isolated verification', build: { beforeDevCommand: '', devUrl: `http://127.0.0.1:${server.httpServer.address().port}` }, app: { windows: [{ label: 'main', title: 'Aibo P2 isolated verification', url: 'probes/p2-native.html', width: 1280, height: 900 }] } }));
const results=[];
try {
  for (stage=0; stage<2; stage++) {
    if(stage===1) {
      const resumedConfig = JSON.parse(await (await import('node:fs/promises')).readFile(config,'utf8'));
      resumedConfig.app.windows.push({label:'secondary',title:'P2 secondary',url:'probes/p2-native.html',width:900,height:700,visible:false});
      resumedConfig.app.security={capabilities:[{identifier:'p2-probe-windows',windows:['main','secondary'],permissions:['core:default','core:window:allow-start-dragging','core:window:allow-toggle-maximize','core:window:allow-minimize','core:window:allow-close','dialog:default']}]};
      await writeFile(config,JSON.stringify(resumedConfig));
    }
    const report = new Promise(resolve => { finish=resolve; });
    const child=spawn('pnpm', ['tauri','dev','--no-watch','--config',config], { stdio:['ignore','pipe','pipe'], detached:true });
    child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
    let timer;
    try {
      const result=await Promise.race([report, new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('P2 native stage timeout')),600_000)),new Promise((_,reject)=>child.on('exit',code=>reject(Error(`native exit ${code}`))))]);
      results.push(result); console.log('P2_STAGE_RESULT '+JSON.stringify(result));
      if(!result.ok) throw Error(result.error);
      saved=result.saved ?? saved;
    } finally {clearTimeout(timer);try{process.kill(-child.pid,'SIGTERM');}catch{} await new Promise(resolve=>setTimeout(resolve,1500));}
  }
} finally {
  await writeFile('/tmp/aibo-p2-native-results.json',JSON.stringify({identifier,results},null,2)+'\n');
  await server.close(); await rm(root,{recursive:true,force:true});
}
