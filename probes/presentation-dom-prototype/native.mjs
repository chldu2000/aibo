import { spawn, execFile, execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { buildPrototype } from './build.mjs';

if (process.platform !== 'darwin') throw Error('This P0 experiment only measures macOS WKWebView');
const here = path.dirname(fileURLToPath(import.meta.url));
const { output } = await buildPrototype();
const binary = path.join(output, 'native-prototype');
execFileSync('xcrun', ['swiftc', '-module-cache-path', '/private/tmp/aibo-p0-swift-cache', path.join(here, 'native.swift'), '-o', binary], { stdio: 'inherit' });
const inputBinary = path.join(output, 'native-input');
execFileSync('xcrun', ['swiftc', '-module-cache-path', '/private/tmp/aibo-p0-swift-cache', path.join(here, 'native-input.swift'), '-o', inputBinary], { stdio: 'inherit' });
for (const mode of ['iframe', 'webview']) {
  const resultPath = path.join(output, `native-${mode}.json`);
  console.log(`Running isolated ${mode} experiment`);
  await new Promise((resolve, reject) => {
    const child = spawn(binary, [mode, path.join(output, `${mode}.html`), resultPath], { stdio: ['ignore', 'pipe', 'inherit'] });
    let stdout = '', buffer = '';
    child.stdout.on('data', chunk => {
      stdout += chunk; buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        if (line === `P0_CONFIRM ${child.pid}`) execFile(inputBinary, [String(child.pid)], { timeout: 15000 }, (error, output) => {
          console.log(output.trim()); if (error) console.error('Native input probe failed:', error.message);
        });
      }
    });
    const timeout = setTimeout(() => { child.kill('SIGKILL'); reject(Error(`${mode}: external watchdog timeout`)); }, 45000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => { clearTimeout(timeout); code === 0 ? resolve() : reject(Error(`${mode}: exited ${code}\n${stdout}`)); });
  });
  const result = JSON.parse(await readFile(resultPath, 'utf8'));
  console.log(JSON.stringify({ mode, completed: result.completed, hostResponsiveDuringLoop: result.hostResponsiveDuringLoop,
    recoveryVerified: result.recoveryVerified, physicalInputVerified: result.physicalInputVerified, error: result.error }));
}
