import { createServer } from 'vite';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
if (process.platform !== 'darwin') throw Error('This native probe currently verifies macOS only');
const mode = process.argv[2] ?? 'hunk';
if (!['hunk', 'file'].includes(mode)) throw Error('Expected hunk or file mode');
const identifier = `local.aibo.corehunk.${Date.now()}`;
const dataDir = path.join(homedir(), 'Library', 'Application Support', identifier);
const root = await mkdtemp(path.join(tmpdir(), 'aibo-core-hunk-'));
const workspacePath = path.join(root, 'workspace');
await mkdir(workspacePath);
execFileSync('git', ['init', '-q', workspacePath]);
const baseline = Array.from({ length: 30 }, (_, i) => `line ${i}\n`).join('');
const changed = baseline.replace('line 1\n', 'first change\n').replace('line 28\n', 'last change\n');
const git = args => execFileSync('git', ['--literal-pathspecs', '-C', workspacePath, ...args], { encoding: 'utf8' });
for (const [key, value] of [['user.name', 'Aibo Fixture'], ['user.email', 'fixture@example.invalid'], ['commit.gpgsign', 'false'], ['core.hooksPath', '/dev/null']]) git(['config', key, value]);
await writeFile(path.join(workspacePath, 'file.txt'), baseline); git(['add', '--', 'file.txt']);
git(['commit', '-qm', 'Native hunk baseline\n\nCo-authored-by: Codex <codex@openai.com>']);
const head = git(['rev-parse', 'HEAD']).trim();
await writeFile(path.join(workspacePath, 'file.txt'), changed);
let child, timer, finish;
const report = new Promise(resolve => { finish = resolve; });
const clicks = [], helpers = new Set();
function isolatedPid() {
  const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,comm='], { encoding: 'utf8' }).trim().split('\n').map(line => {
    const [, pid, parent, command] = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
    return { pid: Number(pid), parent: Number(parent), command };
  });
  const descendants = new Set([child.pid]);
  for (let round = 0; round < 20; round++) for (const row of rows) if (descendants.has(row.parent)) descendants.add(row.pid);
  const candidates = rows.filter(row => descendants.has(row.pid) && path.basename(row.command) === 'aibo');
  if (candidates.length !== 1) throw Error('Cannot uniquely identify isolated Aibo process');
  return candidates[0].pid;
}

const server = await createServer({ server: { host: '127.0.0.1', port: 0, hmr: false, watch: null }, plugins: [{ name: 'core-hunk-probe', configureServer(server) {
  server.middlewares.use('/__task_approval', (req, res) => {
    let body = ''; req.on('data', chunk => body += chunk); req.on('end', () => {
      try {
        const { marker, decision, kind } = JSON.parse(body);
        const helper = spawn('swift', ['probes/native-dialog-click.swift', String(isolatedPid()), marker, decision, kind === 'git' ? '确认 Git 写入' : '确认工程动作'], { stdio: ['ignore', 'pipe', 'pipe'] });
        helpers.add(helper); helper.on('exit', () => helpers.delete(helper));
        const clicked = new Promise((resolve, reject) => {
          let output = ''; helper.stdout.on('data', data => output += data); helper.stderr.on('data', data => output += data);
          helper.on('error', reject); helper.on('exit', code => code === 0 ? resolve(output.trim()) : reject(Error(output)));
        });
        clicks.push(clicked); clicked.catch(error => finish({ ok: false, error: String(error) })); res.end('ok');
      } catch (error) { res.statusCode = 500; res.end(String(error)); finish({ ok: false, error: String(error) }); }
    });
  });
  server.middlewares.use('/__hunk_seed', (req, res) => {
    let body = ''; req.on('data', chunk => body += chunk); req.on('end', () => {
      try {
        const { workspaceId } = JSON.parse(body);
        execFileSync('python3', ['probes/core-hunk-seed.py', path.join(dataDir, 'aibo.sqlite3'), workspaceId, head, baseline, changed]);
        res.end('ok');
      } catch (error) { res.statusCode = 500; res.end(String(error)); finish({ ok: false, error: String(error) }); }
    });
  });
  server.middlewares.use('/__hunk_check', (req, res) => {
    let body = ''; req.on('data', chunk => body += chunk); req.on('end', () => {
      try {
        const { phase } = JSON.parse(body);
        const index = git(['show', ':file.txt']);
        const expected = phase === 'stage' ? (mode === 'file' ? changed : baseline.replace('line 1\n', 'first change\n')) : baseline;
        if (index !== expected) throw Error(`Wrong index after ${phase}`);
        res.end('ok');
      } catch (error) { res.statusCode = 500; res.end(String(error)); finish({ ok: false, error: String(error) }); }
    });
  });
  server.middlewares.use('/__task_config', (_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ workspacePath })); });
  server.middlewares.use('/__task_report', (req, res) => { let body = ''; req.on('data', chunk => body += chunk); req.on('end', () => { res.end('ok'); finish(JSON.parse(body)); }); });
} }] });
await server.listen();
const config = path.join(root, 'tauri.json');
await writeFile(config, JSON.stringify({ identifier, productName: 'Aibo isolated hunk verification', build: { beforeDevCommand: '', devUrl: `http://127.0.0.1:${server.httpServer.address().port}` }, app: { windows: [{ label: 'main', title: 'Core hunk verification', url: `probes/core-${mode}-native.html`, width: 900, height: 700 }] } }));
try {
  child = spawn('pnpm', ['tauri', 'dev', '--no-watch', '--config', config], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
  const result = await Promise.race([report, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Core hunk probe timeout')), 120000); }), new Promise((_, reject) => child.on('exit', code => reject(Error(`Native exit ${code}`))))]);
  if (!result.ok) throw Error(result.error);
  const nativeClicks = await Promise.all(clicks);
  if (nativeClicks.length !== (mode === 'file' ? 3 : 4) || !result.denial || !result.replay || !result.history) throw Error('Incomplete native hunk verification');
  if (git(['show', ':file.txt']) !== baseline) throw Error('Hunk operations changed unrelated index content');
  if (await readFile(path.join(workspacePath, 'file.txt'), 'utf8') !== (mode === 'file' ? baseline : baseline.replace('line 28\n', 'last change\n'))) throw Error('Hunk revert changed another hunk');
  const evidence = { ...result, mode, nativeClicks, platform: process.platform, indexAndWorktreeVerified: true };
  await writeFile(`/tmp/aibo-p4-core-${mode}-native.json`, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
} finally {
  clearTimeout(timer);
  for (const helper of helpers) helper.kill('SIGTERM');
  if (child) try { process.kill(-child.pid, 'SIGTERM'); } catch {}
  await server.close(); await rm(root, { recursive: true, force: true });
}
