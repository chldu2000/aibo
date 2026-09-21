import { createServer } from 'vite';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { buildPrototype } from './build.mjs';

if (process.platform !== 'darwin') throw Error('P0 native gate runner currently measures macOS only');
const here = path.dirname(fileURLToPath(import.meta.url));
const { output } = await buildPrototype();
const root = await mkdtemp(path.join(tmpdir(), 'aibo-dom-p0-gates-'));
const workspacePath = path.join(root, 'workspace'); await mkdir(workspacePath);
execFileSync('git', ['init', '-q', workspacePath]);
await writeFile(path.join(workspacePath, 'p0-proof.txt'), 'base\n');
execFileSync('git', ['-C', workspacePath, 'add', 'p0-proof.txt']);
execFileSync('git', ['-C', workspacePath, '-c', 'user.name=P0 Probe', '-c', 'user.email=p0@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'P0 fixture']);
await writeFile(path.join(workspacePath, 'p0-proof.txt'), 'changed by isolated P0 fixture\n');
const inputBinary = path.join(output, 'approval-input');
execFileSync('xcrun', ['swiftc', '-module-cache-path', '/private/tmp/aibo-p0-swift-cache', 'probes/native-dialog-click.swift', '-o', inputBinary]);
const managementBinary = path.join(output, 'management-input');
execFileSync('xcrun', ['swiftc', '-module-cache-path', '/private/tmp/aibo-p0-swift-cache', path.join(here, 'native-input.swift'), '-o', managementBinary]);
const secret = randomBytes(24).toString('hex');
let finish; const report = new Promise(resolve => { finish = resolve; });
const forbiddenRequests = [], processSamples = [];
function processInfo(pid) {
  if (!Number.isSafeInteger(pid) || pid < 2) throw Error('invalid diagnostic process');
  try {
    const raw = execFileSync('ps', ['-p', String(pid), '-o', 'rss=,%cpu=,comm='], { encoding: 'utf8' }).trim();
    const match = raw.match(/^(\d+)\s+([\d.]+)\s+(.+)$/);
    if (!match) return { pid, present: false };
    return { pid, present: true, rssKiB: Number(match[1]), cpuPercent: Number(match[2]), executable: match[3] };
  } catch { return { pid, present: false }; }
}
const server = await createServer({ cacheDir: path.join(output, 'vite-native-cache'), server: { host: '127.0.0.1', port: 0, hmr: false, watch: null }, plugins: [{ name: 'p0-gates', configureServer(server) {
  server.middlewares.use('/p0-content', async (req, res) => {
    const name = req.url?.replace(/^\//, '');
    if (!['react.html', 'svelte.html'].includes(name)) { res.statusCode = 404; res.end(); return; }
    res.setHeader('Content-Type', 'text/html'); res.end(await readFile(path.join(output, name)));
  });
  server.middlewares.use('/__p0_app_config', (_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ workspacePath, secret })); });
  server.middlewares.use('/__p0_forbidden_read', (req,res) => { forbiddenRequests.push(req.url); res.end('must not be visible'); });
  server.middlewares.use('/__p0_app_report', (req,res) => {
    let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{res.end('ok');finish(JSON.parse(body));});
  });
  server.middlewares.use('/__p0_external', (req,res) => {
    if (req.headers['x-p0-control'] !== secret) { res.statusCode=403;res.end();return; }
    let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{
      try {
        const data=JSON.parse(body);
        if (data.operation === 'progress') { console.log('P0_STEP '+data.step); res.end('{}'); return; }
        const native = processInfo(data.nativePid);
        if (data.operation === 'approve' || data.operation === 'management') {
          // The trusted host sends its current native PID from p0_inspect.
          if (!native.present || !native.executable.endsWith('/aibo')) throw Error('not isolated Aibo process');
          const input=spawn(data.operation === 'management' ? managementBinary : inputBinary,data.operation === 'management' ? [String(data.nativePid),'打开管理中心'] : [String(data.nativePid),data.marker,'允许本次执行','确认 Git 写入'],{stdio:['ignore','pipe','pipe']});
          let stdout='',stderr='';input.stdout.on('data',c=>stdout+=c);input.stderr.on('data',c=>stderr+=c);
          input.once('exit',code=>res.end(JSON.stringify({ok:code===0,stdout,stderr})));return;
        }
        if (!native.present || !native.executable.endsWith('/aibo') || data.hostPid===data.childPid) throw Error('unverified process ownership');
        const sample={native,host:processInfo(data.hostPid),child:processInfo(data.childPid)};
        if (data.operation === 'crash') {
          if (!sample.child.present || !/WebKit.*WebContent/.test(sample.child.executable)) throw Error('not exact WebKit content process');
          process.kill(data.childPid,'SIGKILL');res.end(JSON.stringify({injected:true,pid:data.childPid}));return;
        }
        processSamples.push(sample);res.end(JSON.stringify(sample));
      }catch(error){res.statusCode=400;res.end(JSON.stringify({error:String(error)}));}
    });
  });
} }] });
await server.listen();
const identifier=`local.aibo.domp0gates.${Date.now()}`;
const config=path.join(root,'tauri.json');
await writeFile(config,JSON.stringify({identifier,productName:'Aibo DOM P0 isolated gates',build:{beforeDevCommand:'',devUrl:`http://127.0.0.1:${server.httpServer.address().port}`},app:{security:{capabilities:[
  {identifier:'p0-trusted',webviews:['main'],permissions:['core:default','core:window:allow-set-focus','core:window:allow-set-size','core:window:allow-start-dragging','core:window:allow-toggle-maximize','core:window:allow-minimize','core:window:allow-close','dialog:default','p0-host-api']},
  {identifier:'p0-documents',webviews:['p0-dom-*'],permissions:['p0-document-bridge']},
]},windows:[{label:'main',title:'Aibo DOM P0 isolated gates',url:'probes/presentation-dom-prototype/tauri-app.html',width:1280,height:900}]}}));
let child,timer;
try{
  child=spawn('pnpm',['tauri','dev','--no-watch','--features','presentation-dom-p0','--config',config],{stdio:['ignore','pipe','pipe'],detached:true});
  const log=await import('node:fs').then(fs=>fs.createWriteStream(path.join(output,'tauri-app.log')));
  child.stdout.pipe(log);child.stderr.pipe(log);
  const result=await Promise.race([report,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('P0 App external timeout')),180000)),new Promise((_,reject)=>child.once('exit',code=>reject(Error(`Tauri exited ${code}; inspect ${output}/tauri-app.log`))))]);
  const staged=execFileSync('git',['-C',workspacePath,'diff','--cached','--name-only'],{encoding:'utf8'}).trim();
  const evidence={...result,identifier,platform:process.platform,architecture:process.arch,staged,forbiddenRequests,processSamples};
  await writeFile(path.join(output,'tauri-app-result.json'),JSON.stringify(evidence,null,2));
  console.log(JSON.stringify({completed:result.completed,error:result.error,steps:result.checks?.map(x=>x.step),staged,forbiddenRequests}));
}finally{
  clearTimeout(timer);
  if(child&&child.exitCode===null&&child.signalCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));try{process.kill(-child.pid,'SIGTERM');}catch{}await exited;}
  await server.close();await rm(root,{recursive:true,force:true});
}
