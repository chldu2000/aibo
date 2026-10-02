// Publishes the public @aibolabs SDK packages to the npm registry in dependency order.
// Usage: node scripts/publish-sdk.mjs [--runtime | --presentation] [--dry-run] [--provenance]
// --runtime publishes the host SDK packages, --presentation the presentation tooling; default is both.
// Already published versions are skipped, so a partially failed run can be repeated.
// Before tagging a host SDK release, run `node scripts/check-sdk-release.mjs --record` and commit the result.
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const registry = 'https://registry.npmjs.org/';
const runtime = ['plugin-protocol', 'capability-runtime', 'acp-adapter'];
const presentation = ['web-presentation', 'presentation-tools', 'presentation-workbench'];
const args = new Set(process.argv.slice(2));
const selected = args.has('--runtime') ? runtime : args.has('--presentation') ? presentation : [...runtime, ...presentation];
const dryRun = args.has('--dry-run');

const run = (command, commandArgs, cwd = root) => execFileSync(command, commandArgs, { cwd, stdio: 'inherit' });
const published = (name, version) => {
  try {
    execFileSync('npm', ['view', `${name}@${version}`, 'version', `--registry=${registry}`], { stdio: 'pipe' });
    return true;
  } catch { return false; }
};

run(process.execPath, [path.join(root, 'scripts/build-host-sdk.mjs'), '--check']);
run(process.execPath, [path.join(root, 'scripts/check-sdk-release.mjs')]);
if (selected.includes('plugin-protocol')) {
  run(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', path.join(root, 'packages/plugin-protocol/tsconfig.json')]);
}

for (const name of selected) {
  const directory = path.join(root, 'packages', name);
  const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
  if (manifest.private) throw Error(`${manifest.name} is private`);
  if (!dryRun && published(manifest.name, manifest.version)) {
    console.log(`${manifest.name}@${manifest.version} is already published; skipping`);
    continue;
  }
  const publishArgs = ['publish', '--access', 'public', `--registry=${registry}`];
  if (dryRun) publishArgs.push('--dry-run');
  if (args.has('--provenance')) publishArgs.push('--provenance');
  run('npm', publishArgs, directory);
}
