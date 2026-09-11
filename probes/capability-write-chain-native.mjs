import { createServer } from 'vite';
import { mkdtemp, mkdir, writeFile, readFile, cp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
if (process.platform !== 'darwin') throw Error('This native probe verifies macOS only');
const root = await mkdtemp(path.join(tmpdir(), 'aibo-write-chain-'));
const workspacePath = path.join(root, 'workspace'), packagePath = path.join(root, 'parent'), leafPath = path.join(root, 'leaf'), alternatePath = path.join(root, 'alternate');
await mkdir(workspacePath);
for (const [directory, name, version] of [[packagePath, 'parent', '1.0.0'], [leafPath, 'leaf', '1.0.0'], [alternatePath, 'leaf', '1.0.1']]) {
  await cp('fixtures/plugins/capability-write-chain', directory, { recursive: true });
  const manifest = JSON.parse(await readFile(path.join(directory, 'plugin.json'), 'utf8'));
  manifest.pluginId = `dev.aibo.write-${name}`; manifest.version = version;
  manifest.entrypoint.args = [path.join(root, `${name}-${version}-started`)];
  manifest.contributions[0].id = `${manifest.pluginId}.worker`;
  manifest.contributions[0].operations[0].id = `${manifest.pluginId}.run`;
  manifest.contributions[0].operations[0].capability.id = `${manifest.pluginId}.run`;
  if (name === 'leaf') delete manifest.packageDependencies;
  await writeFile(path.join(directory, 'plugin.json'), JSON.stringify(manifest));
}
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
  server.middlewares.use('/__write_config', (_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ stage, saved, workspacePath, packagePath, leafPath, alternatePath })); });
  server.middlewares.use('/__write_effect', async (_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ leafStarted: await access(path.join(root, 'leaf-1.0.0-started')).then(() => true, () => false), content: await readFile(path.join(workspacePath, 'dev.aibo.write-leaf.txt'), 'utf8').catch(() => '') })); });
  server.middlewares.use('/__write_approval', (req, res) => {
    let body = ''; req.on('data', data => body += data); req.on('end', () => {
      try {
        const { marker, decision } = JSON.parse(body);
        const helper = spawn('swift', ['probes/native-dialog-click.swift', String(isolatedPid()), marker, decision, '确认能力写入'], { stdio: ['ignore', 'pipe', 'pipe'] });
        helpers.add(helper); helper.on('exit', () => helpers.delete(helper));
        const clicked = new Promise((resolve, reject) => { let output = ''; helper.stdout.on('data', data => output += data); helper.stderr.on('data', data => output += data); helper.on('error', reject); helper.on('exit', code => code === 0 ? resolve(output.trim()) : reject(Error(output))); });
        clicks.push(clicked); clicked.catch(error => finish({ ok: false, error: String(error) })); res.end('ok');
      } catch (error) { res.statusCode = 500; res.end(String(error)); finish({ ok: false, error: String(error) }); }
    });
  });
  server.middlewares.use('/__write_report', (req, res) => { let body = ''; req.on('data', data => body += data); req.on('end', () => { res.end('ok'); finish(JSON.parse(body)); }); });
} }] });
await server.listen();
const identifier = `local.aibo.writechain.${Date.now()}`, config = path.join(root, 'tauri.json');
await writeFile(config, JSON.stringify({ identifier, productName: 'Aibo isolated capability writes', build: { beforeDevCommand: '', devUrl: `http://127.0.0.1:${server.httpServer.address().port}` }, app: { windows: [{ label: 'main', title: 'Capability writes', url: 'probes/capability-write-chain-native.html', width: 900, height: 700 }] } }));
try {
  for (stage = 0; stage < 2; stage++) {
    const report = new Promise(resolve => { finish = resolve; }); let timer;
    child = spawn('pnpm', ['tauri', 'dev', '--no-watch', '--config', config], { stdio: ['ignore', 'pipe', 'pipe'], detached: true }); child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
    try {
      const result = await Promise.race([report, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Native write probe timeout')), 120000); }), new Promise((_, reject) => child.on('exit', code => reject(Error(`Native exit ${code}`))))]);
      if (!result.ok) throw Error(result.error); saved = result.saved; results.push(result);
    } finally { clearTimeout(timer); try { process.kill(-child.pid, 'SIGTERM'); } catch {} await new Promise(resolve => setTimeout(resolve, 1500)); }
  }
  const nativeClicks = await Promise.all(clicks); if (nativeClicks.length !== 6) throw Error('Expected root and child approvals for all three requests');
  if (await readFile(path.join(workspacePath, 'dev.aibo.write-parent.txt'), 'utf8') !== 'native-child-denied\nnative-chain\nnative-cancel\n') throw Error('Unexpected parent effects');
  if (await readFile(path.join(workspacePath, 'dev.aibo.write-leaf.txt'), 'utf8') !== 'native-chain\nnative-cancel\n') throw Error('Child effects differ or were replayed');
  if (await access(path.join(workspacePath, 'late.txt')).then(() => true, () => false)) throw Error('Cancelled descendant continued writing');
  if (await readFile(path.join(root, 'parent-1.0.0-started'), 'utf8') !== 'started\nstarted\nstarted\n') throw Error('Unexpected parent activations');
  if (await readFile(path.join(root, 'leaf-1.0.0-started'), 'utf8') !== 'started\nstarted\n') throw Error('Unexpected child activations');
  if (await access(path.join(root, 'leaf-1.0.1-started')).then(() => true, () => false)) throw Error('UI binding rerouted a pinned dependency');
  const evidence = { identifier, platform: process.platform, results, nativeClicks, actualEffectsVerified: true, descendantStopped: true, noReplayExecution: true };
  await writeFile('/tmp/aibo-p4-capability-write-chain-native.json', JSON.stringify(evidence, null, 2) + '\n'); console.log(JSON.stringify(evidence));
} finally { for (const helper of helpers) helper.kill('SIGTERM'); await server.close(); await rm(root, { recursive: true, force: true }); }
