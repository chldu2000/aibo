import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Build a self-contained local package outside the source tree. Never overwrite one.
const output = process.argv[2];
if (!output) throw new Error('Usage: node probes/build-echo-plugin.mjs <new-output-directory>');
const destination = path.resolve(output);
await mkdir(destination);
const fixture = fileURLToPath(new URL('../fixtures/plugins/echo-agent/', import.meta.url));
const manifest = JSON.parse(await readFile(path.join(fixture, 'plugin.json'), 'utf8'));
manifest.entrypoint = { executable: 'echo-agent.mjs' };
manifest.platforms = [`${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}`];
manifest.dependencies = [{ kind: 'runtime', name: process.platform === 'win32' ? 'node.exe' : 'node', versionRange: '>=22', required: true }];
manifest.resources = [];
manifest.agents[0].requestedPermissions = [];
await copyFile(path.join(fixture, 'echo-agent.mjs'), path.join(destination, 'echo-agent.mjs'));
await writeFile(path.join(destination, 'plugin.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Echo plugin package: ${destination}`);
