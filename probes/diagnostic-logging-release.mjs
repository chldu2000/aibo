import assert from 'node:assert/strict';
import { readFile, readdir, writeFile, rm, access } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
if (process.platform !== 'darwin') throw Error('This packaged profile probe currently requires macOS');
if (process.argv.includes('--build')) {
  const input = { identifier: `local.aibo.diagnosticrelease.${Date.now()}`, productName: 'Aibo diagnostic release probe', app: { windows: [{ label: 'main', title: 'Isolated release diagnostics', width: 1100, height: 740 }] } };
  await writeFile('/private/tmp/aibo-diagnostic-release-config.json', JSON.stringify(input));
  await promisify(execFile)('pnpm', ['tauri', 'build', '--bundles', 'app', '--config', '/private/tmp/aibo-diagnostic-release-config.json'], { timeout: 300000, maxBuffer: 10 * 1024 * 1024 });
}
const config = JSON.parse(await readFile('/private/tmp/aibo-diagnostic-release-config.json', 'utf8'));
assert(/^local\.aibo\.diagnosticrelease\.\d+$/.test(config.identifier), 'Only isolated diagnostic probe identifiers are accepted');
const bundle = path.resolve('src-tauri/target/release/bundle/macos/Aibo diagnostic release probe.app');
const binary = path.join(bundle, 'Contents/MacOS/aibo');
await access(binary);
const data = path.join(homedir(), 'Library/Application Support', config.identifier);
const directory = path.join(data, 'logs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function rows() {
  const values = [];
  for (const name of await readdir(directory).catch(() => [])) {
    if (!name.endsWith('.jsonl')) continue;
    const text = await readFile(path.join(directory, name), 'utf8');
    for (const line of text.trim().split('\n').filter(Boolean)) values.push(JSON.parse(line));
  }
  return values;
}
const evidence = [];
let child;
try {
  for (let run = 0; run < 2; run++) {
    child = spawn(binary, [], { stdio: 'ignore' });
    const exit = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
    const deadline = Date.now() + 30000;
    let boot;
    while (Date.now() < deadline) {
      boot = (await rows()).find(row => row.pid === child.pid && row.event === 'app.ready')?.boot_id;
      if (boot) break;
      await delay(100);
    }
    assert(boot, 'Packaged frontend must finish initialization and write app.ready');
    await promisify(execFile)('/usr/bin/osascript', ['-e', `tell application "${bundle}" to quit`], { timeout: 10000 });
    let timer;
    const ended = await Promise.race([exit, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Packaged normal exit timeout')), 15000); })]).finally(() => clearTimeout(timer));
    const values = (await rows()).filter(row => row.boot_id === boot).sort((a, b) => a.sequence - b.sequence);
    assert(values.some(row => row.event === 'app.stopped'));
    assert(!values.some(row => row.event === 'app.previous_exit_unknown'));
    assert(values.every(row => row.build_channel === 'release' && row.app_version === '0.1.1' && row.os === 'macos' && row.arch === 'aarch64'));
    assert.equal(await readdir(path.join(data, 'development/logs')).then(() => true, () => false), false);
    evidence.push({ boot_id: boot, directory, exit: ended, events: values.map(row => row.event) }); child = undefined;
  }
  assert.notEqual(evidence[0].boot_id, evidence[1].boot_id);
  await writeFile('/private/tmp/aibo-diagnostic-logging-release.json', JSON.stringify({ platform: 'macos-arm64', bundle, evidence }, null, 2) + '\n');
  console.log(JSON.stringify({ passed: true, bundle, evidence }));
} finally {
  if (child) { child.kill('SIGKILL'); }
  await rm(data, { recursive: true, force: true });
}
