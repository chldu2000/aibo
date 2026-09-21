// Read-only check: does an ungranted WebView receive application IPC by default?
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = await mkdtemp(path.join(tmpdir(), 'aibo-dom-p0-ipc-'));
const identifier = `local.aibo.domp0.${Date.now()}`;
let finish;
const report = new Promise(resolve => { finish = resolve; });
const server = await createServer({ server: { host: '127.0.0.1', port: 0, hmr: false, watch: null }, plugins: [{ name: 'p0-ipc', configureServer(server) {
  server.middlewares.use('/__p0_ipc_report', (req, res) => {
    let body = ''; req.on('data', chunk => { body += chunk; });
    req.on('end', () => { res.end('ok'); finish(JSON.parse(body)); });
  });
} }] });
await server.listen();
const config = path.join(root, 'tauri.json');
await writeFile(config, JSON.stringify({ identifier, productName: 'Aibo P0 IPC isolated probe',
  build: { beforeDevCommand: '', devUrl: `http://127.0.0.1:${server.httpServer.address().port}` },
  app: { security: { capabilities: [{ identifier: 'p0-host-only', windows: ['p0-trusted-host'], permissions: ['core:default'] }] },
    windows: [{ label: 'p0-ungranted', title: 'Aibo P0 ungranted WebView', url: 'probes/presentation-dom-prototype/tauri-ipc.html', width: 800, height: 300 }] } }));
let child, timer;
try {
  child = spawn('pnpm', ['tauri', 'dev', '--no-watch', '--config', config], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
  const result = await Promise.race([report,
    new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Tauri P0 timeout')), 180000); }),
    new Promise((_, reject) => child.once('exit', code => reject(Error(`Tauri exited ${code}`)))),
  ]);
  await mkdir(path.join(here, 'dist'), { recursive: true });
  const evidence = { identifier, platform: process.platform, architecture: process.arch, result,
    scope: 'Actual Aibo Tauri IPC, isolated application identity, read-only empty workspace list; no user data or write operations',
    verdict: result.accepted ? 'An ungranted WebView can call application commands: explicit application IPC admission required before DOM plugins' : 'Command rejected; inspect error before claiming authorization isolation' };
  await writeFile(path.join(here, 'dist/tauri-ipc.json'), JSON.stringify(evidence, null, 2));
  console.log('P0_IPC_RESULT ' + JSON.stringify(evidence));
} finally {
  clearTimeout(timer);
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = new Promise(resolve => child.once('exit', resolve));
    try { process.kill(-child.pid, 'SIGTERM'); } catch {}
    await exited;
  }
  await server.close(); await rm(root, { recursive: true, force: true });
}
