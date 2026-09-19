import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'packages/plugin-host/sdk.json');
const temporary = await mkdtemp(path.join(tmpdir(), 'aibo-host-sdk-'));
try {
  execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'),
    '-p', path.join(root, 'packages/plugin-protocol/tsconfig.json'), '--outDir', temporary], { stdio: 'pipe' });
  const sdk = { version: '0.1.0', exports: {}, modules: {} };
  for (const name of ['capability-runtime', 'plugin-protocol']) {
    const directory = path.join(root, 'packages', name);
    const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
    for (const [entry, target] of Object.entries(manifest.exports)) {
      sdk.exports[manifest.name + (entry === '.' ? '' : entry.slice(1))] = `${name}/${target.import.slice(2)}`;
    }
    const files = name === 'capability-runtime' ? ['runtime.mjs', 'stdio.mjs']
      : (await readdir(temporary)).filter(file => file.endsWith('.js')).sort().map(file => `dist/${file}`);
    for (const file of files) {
      sdk.modules[`${name}/${file}`] = await readFile(name === 'capability-runtime'
        ? path.join(directory, file) : path.join(temporary, path.basename(file)), 'utf8');
    }
  }
  const generated = JSON.stringify(sdk, null, 2) + '\n';
  if (process.argv.includes('--check')) {
    if (await readFile(output, 'utf8') !== generated) throw Error('Host SDK is stale; run node scripts/build-host-sdk.mjs');
  } else await writeFile(output, generated);
} finally { await rm(temporary, { recursive: true, force: true }); }
