import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { mkdtemp, mkdir, chmod, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);
if (!['darwin', 'linux'].includes(process.platform)) throw Error('This desktop probe requires macOS or Linux');
const profileRoot = process.platform === 'darwin'
  ? path.join(homedir(), 'Library', 'Application Support')
  : process.env.XDG_DATA_HOME || path.join(homedir(), '.local', 'share');
const root = await mkdtemp(path.join(tmpdir(), 'aibo-diagnostic-native-'));
const identifier = `local.aibo.diagnosticprobe.${Date.now()}`;
const data = path.join(profileRoot, identifier, 'development');
let resolveReport, child;
let permissionFault = false;
const faultProfiles = [];
const reports = [];
let networkCanaryRequests = 0;
async function verifyLinuxFolderWindow() {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const { stdout } = await execute('xdotool', ['search', '--onlyvisible', '--class', 'Thunar']);
      for (const id of stdout.trim().split('\n').filter(Boolean)) {
        const { stdout: title } = await execute('xdotool', ['getwindowname', id]);
        if (/^logs(?:\s+[-–—].*)?$/.test(title.trim())) return { id, title: title.trim(), fileManager: 'Thunar' };
      }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw Error('The native file manager did not display the logs directory');
}
const server = await createServer({ server: { host: '127.0.0.1', port: 0, hmr: false, watch: null }, plugins: [{ name: 'diagnostic-native', configureServer(server) {
  for (const endpoint of ['/__diagnostic_network_canary', '/__diagnostic_import_canary.js']) server.middlewares.use(endpoint, (_req, res) => {
    networkCanaryRequests++;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'text/javascript');
    res.end('self.aiboSandboxImportCanary = true;');
  });
  server.middlewares.use('/__diagnostic_config', (_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ permissionFault })); });
  server.middlewares.use('/__diagnostic_folder_opened', (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    void (process.platform === 'linux' ? verifyLinuxFolderWindow() : Promise.resolve(null))
      .then(proof => res.end(JSON.stringify({ ok: true, proof })), error => res.end(JSON.stringify({ ok: false, error: error.message })));
  });
  server.middlewares.use('/__diagnostic_permission', (_req, res) => { void chmod(path.join(data, 'logs'), 0o400).then(() => res.end('ok')); });
  server.middlewares.use('/__diagnostic_restore', (_req, res) => { void chmod(path.join(data, 'logs'), 0o700).then(() => res.end('ok')); });
  server.middlewares.use('/__diagnostic_report', (req, res) => {
    let body = ''; req.on('data', bytes => { body += bytes; });
    req.on('end', () => { res.end('ok'); resolveReport(JSON.parse(body)); });
  });
} }] });
await server.listen();
try {
  let mainCount = 0;
  for (const label of ['untrusted', 'main', 'main']) {
    permissionFault = label === 'main' && ++mainCount === 1;
    const config = path.join(root, `${label}.json`);
    await writeFile(config, JSON.stringify({ identifier, productName: 'Aibo diagnostic probe', build: { beforeDevCommand: '', devUrl: `http://127.0.0.1:${server.httpServer.address().port}` }, app: { windows: [{ label, title: 'Isolated diagnostic probe', url: 'probes/diagnostic-logging-native.html', width: 900, height: 650 }] } }));
    const report = new Promise(resolve => { resolveReport = resolve; });
    child = spawn('pnpm', ['tauri', 'dev', '--no-watch', '--config', config], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
    const exit = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
    let timer;
    const result = await Promise.race([report, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Native diagnostic probe timeout')), 180000); })]).finally(() => clearTimeout(timer));
    assert(result.ok, result.error); reports.push(result);
    if (process.platform === 'linux' && result.openedDirectory) assert(result.folderWindow, 'Native directory window observed before permission fault');
    if (label === 'untrusted') { process.kill(-child.pid, 'SIGKILL'); await exit; }
    else {
      assert.equal(result.status.directory, path.join(data, 'logs'));
      await Promise.race([exit, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Native normal shutdown timeout')), 10000); })]).finally(() => clearTimeout(timer));
    }
    child = undefined;
  }
  const directory = path.join(data, 'logs');
  const files = (await readdir(directory)).filter(name => name.endsWith('.jsonl'));
  const rows = [];
  for (const file of files) {
    const text = await readFile(path.join(directory, file), 'utf8');
    assert(!text.includes('diagnostic-native-canary'));
    assert(!text.includes('native-presentation-secret-canary'));
    for (const line of text.trim().split('\n').filter(Boolean)) rows.push(JSON.parse(line));
  }
  for (const event of ['app.starting', 'startup.stage_completed', 'app.ready', 'app.stopped', 'app.previous_exit_unknown', 'frontend.exception', 'frontend.unhandled_rejection', 'diagnostics.dropped']) assert(rows.some(row => row.event === event), event);
  assert.equal(rows.filter(row => row.event === 'frontend.exception').length, 4);
  assert.equal(rows.filter(row => row.event === 'presentation.failed').length, 2);
  assert.equal(rows.filter(row => row.event === 'app.previous_exit_unknown').length, 1, 'Clean restart must not produce an abnormal exit warning');
  for (const event of ['diagnostics.write_failed', 'diagnostics.recovered']) assert(rows.some(row => row.event === event), event);
  const recovered = rows.find(row => row.event === 'diagnostics.recovered');
  assert(recovered.duration_ms >= 29_000 && recovered.duration_ms < 40_000, 'Production recovery interval');
  assert(recovered.first_failure_at && recovered.recovered_at);
  assert(rows.filter(row => row.event.startsWith('frontend.')).every(row => row.window_id === 'main'));
  for (const row of rows) for (const field of ['schema', 'boot_id', 'sequence', 'app_version', 'build_channel', 'os', 'arch', 'elapsed_ms']) assert(field in row, field);
  const startupFailures = [];
  for (const stage of ['database.open', 'database.migrate', 'plugin.register']) {
    const faultIdentifier = `${identifier}.${stage.replaceAll('.', '')}`;
    const faultData = path.join(profileRoot, faultIdentifier, 'development');
    faultProfiles.push(path.dirname(faultData)); await mkdir(faultData, { recursive: true });
    if (stage === 'database.open') await mkdir(path.join(faultData, 'aibo.sqlite3'));
    if (stage === 'database.migrate') { const db = new DatabaseSync(path.join(faultData, 'aibo.sqlite3')); db.exec('CREATE TABLE _sqlx_migrations(bad INTEGER)'); db.close(); }
    if (stage === 'plugin.register') await writeFile(path.join(faultData, 'bundled-plugin-sources'), 'startup-secret-canary');
    const config = path.join(root, `${stage}.json`);
    await writeFile(config, JSON.stringify({ identifier: faultIdentifier, build: { beforeDevCommand: '', devUrl: `http://127.0.0.1:${server.httpServer.address().port}` }, app: { windows: [{ label: 'main', url: 'probes/diagnostic-logging-native.html' }] } }));
    child = spawn('pnpm', ['tauri', 'dev', '--no-watch', '--config', config], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
    let timer;
    const exit = await Promise.race([new Promise(resolve => child.once('exit', code => resolve(code))), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Startup failure probe timeout')), 120000); })]).finally(() => clearTimeout(timer));
    // Tauri's dev wrapper may return 0 after a native abort. The actual failure
    // phase and absence of ready/stopped are asserted against the native files.
    child = undefined;
    const faultRows = [];
    for (const file of await readdir(path.join(faultData, 'logs'))) {
      const text = await readFile(path.join(faultData, 'logs', file), 'utf8'); assert(!text.includes('startup-secret-canary'));
      if (file.endsWith('.jsonl')) for (const line of text.trim().split('\n').filter(Boolean)) faultRows.push(JSON.parse(line));
    }
    assert(faultRows.some(row => row.event === 'app.starting'));
    assert.deepEqual(faultRows.filter(row => row.event === 'startup.failed').map(row => row.stage), [stage]);
    assert(!faultRows.some(row => row.event === 'app.ready' || row.event === 'app.stopped'));
    startupFailures.push({ stage, exit, events: faultRows.map(row => row.event) });
  }
  assert.equal(networkCanaryRequests, 0, 'Package Workers cannot fetch or import even from the host origin');
  const evidence = { platform: process.platform, networkCanaryRequests, reports, files, startupFailures, events: rows.map(row => ({ boot_id: row.boot_id, sequence: row.sequence, event: row.event })) };
  await writeFile(path.join(process.platform === 'darwin' ? '/private/tmp' : tmpdir(), 'aibo-diagnostic-logging-native.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
} finally {
  if (child) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
  await server.close(); await rm(root, { recursive: true, force: true });
  await rm(path.dirname(data), { recursive: true, force: true });
  for (const profile of faultProfiles) await rm(profile, { recursive: true, force: true });
}
