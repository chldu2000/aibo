// Optional development fixture for legacy plugin probes. Not bundled in release apps.
// Installed applications manage on-demand downloads in src-tauri/src/node_runtime.rs.
import { createHash } from 'node:crypto';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const lock = JSON.parse(await readFile(new URL('./node-runtime.json', import.meta.url), 'utf8'));
const rustTarget = process.env.TAURI_ENV_TARGET_TRIPLE;
const rustTargets = {
  'aarch64-apple-darwin': 'darwin-arm64', 'x86_64-apple-darwin': 'darwin-x64',
  'aarch64-unknown-linux-gnu': 'linux-arm64', 'x86_64-unknown-linux-gnu': 'linux-x64',
  'aarch64-pc-windows-msvc': 'win-arm64', 'x86_64-pc-windows-msvc': 'win-x64',
};
if (rustTarget && !rustTargets[rustTarget]) throw Error(`Unsupported Node distribution target: ${rustTarget}`);
const target = process.env.AIBO_NODE_TARGET ?? (rustTarget ? rustTargets[rustTarget]
  : `${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`);
const spec = lock.targets[target];
if (!spec || rustTarget?.includes('musl')) throw Error(`Unsupported Node distribution target: ${rustTarget ?? target}`);
const destination = path.join(root, 'src-tauri/resources/node-runtime');
const binary = target.startsWith('win-') ? 'node.exe' : 'node';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
try {
  const installed = JSON.parse(await readFile(path.join(destination, 'runtime.json'), 'utf8'));
  if (installed.version === lock.version && installed.target === target && installed.archiveSha256 === spec.sha256
      && installed.binarySha256 === digest(await readFile(path.join(destination, binary)))
      && installed.licenseSha256 === digest(await readFile(path.join(destination, 'LICENSE')))) process.exit(0);
} catch { /* prepare missing or damaged resources */ }
const cache = path.join(root, '.runtime-cache');
await mkdir(cache, { recursive: true });
const archive = process.env.AIBO_NODE_ARCHIVE ?? path.join(cache, spec.archive);
let bytes;
try { bytes = await readFile(archive); }
catch (error) {
  if (process.env.AIBO_NODE_ARCHIVE || error.code !== 'ENOENT') throw error;
  const response = await fetch(`https://nodejs.org/dist/v${lock.version}/${spec.archive}`, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw Error(`Node download failed: ${response.status}`);
  bytes = Buffer.from(await response.arrayBuffer());
}
if (digest(bytes) !== spec.sha256) throw Error('Node archive checksum mismatch');
if (!process.env.AIBO_NODE_ARCHIVE) await writeFile(archive, bytes);
const temporary = await mkdtemp(path.join(cache, 'extract-'));
try {
  if (target.startsWith('win-')) {
    // tar on supported Windows development systems understands zip archives.
    execFileSync('tar', ['-xf', archive, '-C', temporary]);
  } else execFileSync('tar', ['-xzf', archive, '-C', temporary]);
  const distribution = path.join(temporary, spec.archive.replace(/\.(tar\.gz|zip)$/, ''));
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  await copyFile(path.join(distribution, target.startsWith('win-') ? binary : `bin/${binary}`), path.join(destination, binary));
  await chmod(path.join(destination, binary), 0o755);
  await copyFile(path.join(distribution, 'LICENSE'), path.join(destination, 'LICENSE'));
  await writeFile(path.join(destination, 'runtime.json'), JSON.stringify({ version: lock.version, target,
    archiveSha256: spec.sha256, binarySha256: digest(await readFile(path.join(destination, binary))),
    licenseSha256: digest(await readFile(path.join(destination, 'LICENSE'))) }, null, 2) + '\n');
} finally { await rm(temporary, { recursive: true, force: true }); }
console.log(`Prepared private Node ${lock.version} (${target})`);
