import { createServer } from 'vite';
import { mkdtemp, mkdir, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
if (process.platform !== 'darwin') throw Error('This native probe currently verifies macOS only');
const root = await mkdtemp(path.join(tmpdir(), 'aibo-task-cancel-'));
const workspacePath = path.join(root, 'workspace');
await mkdir(workspacePath);
let child, timer, finish;
const report = new Promise(resolve => { finish = resolve; });
const server = await createServer({ server: { host: '127.0.0.1', port: 0, hmr: false, watch: null }, plugins: [{ name: 'task-cancel-probe', configureServer(server) {
  server.middlewares.use('/__task_config', (_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ workspacePath })); });
  server.middlewares.use('/__task_started', (_req, res) => { readdir(workspacePath).then(files => res.end(JSON.stringify(files)), error => { res.statusCode = 500; res.end(String(error)); }); });
  server.middlewares.use('/__task_report', (req, res) => { let body = ''; req.on('data', chunk => body += chunk); req.on('end', () => { res.end('ok'); finish(JSON.parse(body)); }); });
} }] });
await server.listen();
const config = path.join(root, 'tauri.json');
await writeFile(config, JSON.stringify({ identifier: `local.aibo.taskcancel.${Date.now()}`, productName: 'Aibo isolated task cancellation', build: { beforeDevCommand: '', devUrl: `http://127.0.0.1:${server.httpServer.address().port}` }, app: { windows: [{ label: 'main', title: 'Task cancellation verification', url: 'probes/project-task-cancel-native.html', width: 900, height: 700 }] } }));
try {
  child = spawn('pnpm', ['tauri', 'dev', '--no-watch', '--config', config], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
  const result = await Promise.race([report, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Task cancellation probe timeout')), 120000); }), new Promise((_, reject) => child.on('exit', code => reject(Error(`Native exit ${code}`))))]);
  if (!result.ok) throw Error(result.error);
  const files = await readdir(workspacePath);
  for (const kit of ['shadcn', 'material3']) {
    if (!files.includes(`${kit}-before`) || files.includes(`${kit}-after`)) throw Error(`Unexpected descendant effects for ${kit}`);
  }
  const evidence = { ...result, platform: process.platform, earlierEffectsPreserved: true, descendantEffectsStopped: true };
  await writeFile('/tmp/aibo-p4-task-cancel-native.json', JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
} finally {
  clearTimeout(timer);
  if (child) try { process.kill(-child.pid, 'SIGTERM'); } catch {}
  await server.close(); await rm(root, { recursive: true, force: true });
}
