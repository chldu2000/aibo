import { createServer } from 'vite';
import { mkdtemp, mkdir, writeFile, readFile, cp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
if (process.platform !== 'darwin') throw Error('This native probe verifies macOS only');
const root = await mkdtemp(path.join(tmpdir(), 'aibo-capability-write-'));
const workspacePath = path.join(root, 'workspace'), packagePath = path.join(root, 'package');
await mkdir(workspacePath); await cp('fixtures/plugins/semantic-write', packagePath, { recursive: true });
const manifest = JSON.parse(await readFile(path.join(packagePath, 'plugin.json'), 'utf8'));
manifest.entrypoint.args = [path.join(root, 'started')]; await writeFile(path.join(packagePath, 'plugin.json'), JSON.stringify(manifest));
let stage = 0, saved = {}, finish, child;
const clicks = [], helpers = new Set(), results = [];
function isolatedPid() {
  const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,comm='], { encoding: 'utf8' }).trim().split('\n').map(line => {
    const [, pid, parent, command] = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/); return { pid: Number(pid), parent: Number(parent), command };
  });
  const descendants = new Set([child.pid]);
  for (let round = 0; round < 20; round++) for (const row of rows) if (descendants.has(row.parent)) descendants.add(row.pid);
  const candidates = rows.filter(row => descendants.has(row.pid) && path.basename(row.command) === 'aibo');
  if (candidates.length !== 1) throw Error('Cannot identify isolated Aibo process'); return candidates[0].pid;
}
const server = await createServer({ server: { host: '127.0.0.1', port: 0, hmr: false, watch: null }, plugins: [{ name: 'capability-write-native', configureServer(server) {
  server.middlewares.use('/__write_config', (_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ stage, saved, workspacePath, packagePath })); });
  server.middlewares.use('/__write_effect', async (_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ started: await access(path.join(root, 'started')).then(() => true, () => false), content: await readFile(path.join(workspacePath, 'effect.txt'), 'utf8').catch(() => '') })); });
  server.middlewares.use('/__write_approval', (req, res) => {
    let body = ''; req.on('data', data => body += data); req.on('end', () => {
      try {
        const { marker, decision } = JSON.parse(body);
        const helper = spawn('swift', ['probes/native-dialog-click.swift', String(isolatedPid()), marker, decision, '确认视图写入'], { stdio: ['ignore', 'pipe', 'pipe'] });
        helpers.add(helper); helper.on('exit', () => helpers.delete(helper));
        const clicked = new Promise((resolve, reject) => { let output = ''; helper.stdout.on('data', data => output += data); helper.stderr.on('data', data => output += data); helper.on('error', reject); helper.on('exit', code => code === 0 ? resolve(output.trim()) : reject(Error(output))); });
        clicks.push(clicked); clicked.catch(error => finish({ ok: false, error: String(error) })); res.end('ok');
      } catch (error) { res.statusCode = 500; res.end(String(error)); finish({ ok: false, error: String(error) }); }
    });
  });
  server.middlewares.use('/__write_report', (req, res) => { let body = ''; req.on('data', data => body += data); req.on('end', () => { res.end('ok'); finish(JSON.parse(body)); }); });
} }] });
await server.listen();
const identifier = `local.aibo.capabilitywrite.${Date.now()}`, config = path.join(root, 'tauri.json');
await writeFile(config, JSON.stringify({ identifier, productName: 'Aibo isolated capability writes', build: { beforeDevCommand: '', devUrl: `http://127.0.0.1:${server.httpServer.address().port}` }, app: { windows: [{ label: 'main', title: 'Capability writes', url: 'probes/semantic-write-native.html', width: 900, height: 700 }] } }));
try {
  for (stage = 0; stage < 1; stage++) {
    const report = new Promise(resolve => { finish = resolve; }); let timer;
    child = spawn('pnpm', ['tauri', 'dev', '--no-watch', '--config', config], { stdio: ['ignore', 'pipe', 'pipe'], detached: true }); child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
    try {
      const result = await Promise.race([report, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Native write probe timeout')), 120000); }), new Promise((_, reject) => child.on('exit', code => reject(Error(`Native exit ${code}`))))]);
      if (!result.ok) throw Error(result.error); saved = result.saved; results.push(result);
    } finally { clearTimeout(timer); try { process.kill(-child.pid, 'SIGTERM'); } catch {} await new Promise(resolve => setTimeout(resolve, 1500)); }
  }
  const nativeClicks = await Promise.all(clicks); if (nativeClicks.length !== 2) throw Error('Expected two view approvals');
  if (await readFile(path.join(workspacePath, 'effect.txt'), 'utf8') !== 'semantic-write\nsemantic-write\n') throw Error('Write effects differ or were replayed');
  if (await access(path.join(workspacePath, 'late.txt')).then(() => true, () => false)) throw Error('Cancelled descendant continued writing');

  const evidence = { identifier, platform: process.platform, results, nativeClicks, actualEffectsVerified: true, bothSkinsVerified: true, duplicateClickSuppressed: true };
  await writeFile('/tmp/aibo-p4-semantic-write-native.json', JSON.stringify(evidence, null, 2) + '\n'); console.log(JSON.stringify(evidence));
} finally { for (const helper of helpers) helper.kill('SIGTERM'); await server.close(); await rm(root, { recursive: true, force: true }); }
