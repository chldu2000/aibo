import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const preload = new URL('../packages/plugin-host/register.mjs', import.meta.url).href;

test('embedded SDK matches public package sources and exports', () => {
  execFileSync(process.execPath, [path.join(root, 'scripts/build-host-sdk.mjs'), '--check'], { stdio: 'pipe' });
});

test('host SDK loads outside the repo alongside plugin-owned third-party modules', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'aibo-sdk space-#-'));
  try {
    await mkdir(path.join(directory, 'node_modules/third-party'), { recursive: true });
    await writeFile(path.join(directory, 'node_modules/third-party/package.json'), JSON.stringify({ name: 'third-party', main: 'index.cjs' }));
    await writeFile(path.join(directory, 'node_modules/third-party/index.cjs'), 'module.exports = 42;');
    const sdk = JSON.parse(await readFile(new URL('../packages/plugin-host/sdk.json', import.meta.url)));
    const entry = path.join(directory, 'worker.mjs');
    await writeFile(entry, `
      import assert from 'node:assert/strict';
      import { serveCapability } from '@aibolabs/capability-runtime/stdio';
      import { SEMANTIC_SCHEMA, readAgentIcon } from '@aibolabs/plugin-protocol';
      import thirdParty from 'third-party';
      assert.equal(typeof serveCapability, 'function');
      assert.equal(SEMANTIC_SCHEMA, 'aibo.semantic-view/v1');
      assert.deepEqual(readAgentIcon({path:'M0 0Z'}), {path:'M0 0Z'});
      assert.equal(thirdParty, 42);
      for (const entry of ${JSON.stringify(Object.keys(sdk.exports))}) await import(entry);
      // Plugins installed before the @aibolabs rename import the deprecated @aibo prefix.
      const legacy = await import('@aibo/capability-runtime/stdio');
      assert.equal(legacy.serveCapability, serveCapability);
      assert.equal((await import('@aibo/plugin-protocol')).SEMANTIC_SCHEMA, SEMANTIC_SCHEMA);
      for (const entry of ['@aibolabs/capability-runtime/runtime.mjs', '@aibolabs/private', '@aibolabs/plugin-protocol/package.json', '@aibo/private', '@aibo/capability-runtime/runtime.mjs', 'aibo-sdk:///capability-runtime/runtime.mjs']) {
        await assert.rejects(import(entry), {code:'ERR_PACKAGE_PATH_NOT_EXPORTED'});
      }
      console.log('HOST_SDK_OK');
    `);
    const output = execFileSync(process.execPath, ['--import', preload, entry], { cwd: directory, encoding: 'utf8' });
    assert.equal(output.trim(), 'HOST_SDK_OK');
    // Without the explicit host preload, the old Node resolution behavior is unchanged.
    assert.throws(() => execFileSync(process.execPath, [entry], { cwd: directory, stdio: 'pipe' }),
      error => error.stderr.toString().includes('ERR_MODULE_NOT_FOUND'));
    const legacy = path.join(directory, 'node_modules/@aibolabs/capability-runtime');
    await mkdir(legacy, { recursive: true });
    await writeFile(path.join(legacy, 'package.json'), JSON.stringify({ type: 'module', exports: { './stdio': './stdio.mjs' } }));
    await writeFile(path.join(legacy, 'stdio.mjs'), 'export const serveCapability = {legacy: true};');
    await writeFile(entry, "import {serveCapability} from '@aibolabs/capability-runtime/stdio'; console.log(serveCapability.legacy ? 'legacy' : 'host');");
    assert.equal(execFileSync(process.execPath, [entry], { cwd: directory, encoding: 'utf8' }).trim(), 'legacy');
    assert.equal(execFileSync(process.execPath, ['--import', preload, entry], { cwd: directory, encoding: 'utf8' }).trim(), 'host');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('every public SDK export keeps a deprecated @aibo alias to the same module', async () => {
  const sdk = JSON.parse(await readFile(new URL('../packages/plugin-host/sdk.json', import.meta.url)));
  const current = Object.keys(sdk.exports).filter(name => name.startsWith('@aibolabs/'));
  assert.ok(current.length > 0);
  assert.equal(Object.keys(sdk.exports).length, current.length * 2);
  for (const name of current) assert.equal(sdk.exports[name.replace('@aibolabs/', '@aibo/')], sdk.exports[name], name);
});

test('runtime SDK packages share the host SDK version', () => {
  execFileSync(process.execPath, [path.join(root, 'scripts/check-sdk-release.mjs')], { stdio: 'pipe' });
});
