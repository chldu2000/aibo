// Keeps published SDK packages aligned with the host SDK snapshot and released versions immutable.
// `--record` stores the current snapshot digest as released; run it when publishing a new SDK version.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const runtimePackages = ['plugin-protocol', 'capability-runtime', 'acp-adapter'];
const releasesUrl = new URL('packages/plugin-host/sdk-releases.json', root);
const read = async (relative) => JSON.parse(await readFile(new URL(relative, root), 'utf8'));

const snapshot = await readFile(new URL('packages/plugin-host/sdk.json', root));
const { version } = JSON.parse(snapshot);
const digest = createHash('sha256').update(snapshot).digest('hex');
const releases = await read('packages/plugin-host/sdk-releases.json');
const failures = [];

for (const name of runtimePackages) {
  const manifest = await read(`packages/${name}/package.json`);
  if (manifest.name !== `@aibolabs/${name}`) failures.push(`${name}: package name must be @aibolabs/${name}`);
  if (manifest.version !== version) failures.push(`${manifest.name}: version ${manifest.version} must equal host SDK ${version}`);
  for (const [dependency, range] of Object.entries(manifest.dependencies ?? {})) {
    if (runtimePackages.some(other => dependency === `@aibolabs/${other}`) && range !== version) {
      failures.push(`${manifest.name}: dependency ${dependency}@${range} must equal host SDK ${version}`);
    }
  }
}

if (process.argv.includes('--record')) {
  if (failures.length) throw Error(failures.join('\n'));
  if (releases[version] && releases[version] !== digest) throw Error(`Host SDK ${version} is already released with different contents`);
  releases[version] = digest;
  await writeFile(releasesUrl, JSON.stringify(releases, null, 2) + '\n');
  console.log(`Recorded host SDK ${version}`);
} else {
  if (releases[version] && releases[version] !== digest) {
    failures.push(`Host SDK ${version} is already released; bump the version in scripts/build-host-sdk.mjs, src-tauri/src/plugin_sdk.rs and the runtime packages`);
  }
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
  }
}
