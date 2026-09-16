import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import Ajv from 'ajv/dist/2020.js';
import { readAgentIcon } from '../packages/plugin-protocol/src/agent-icon.ts';
const read = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const ajv = new Ajv({ strict: false, allErrors: true });
ajv.addFormat('uri', value => { try { return Boolean(new URL(value).protocol); } catch { return false; } });
const validate = ajv.compile(await read('../contracts/plugin-manifest.v2.schema.json'));
const view = await read('../fixtures/plugins/platform-v2/declarative.json');
const provider = await read('../fixtures/plugins/platform-v2/provider.json');
const dependent = await read('../fixtures/plugins/platform-v2/dependent.json');
const chain = await read('../fixtures/plugins/capability-chain/plugin.json');
const git = await read('../fixtures/plugins/git-read/plugin.json');
const gitView = await read('../fixtures/plugins/git-view/plugin.json');
const writer = await read('../fixtures/plugins/capability-write/plugin.json');
const writeChain = await read('../fixtures/plugins/capability-write-chain/plugin.json');

test('agent icons are bounded path data with no scripts, URLs or arbitrary SVG attributes', async () => {
  for (const name of ['codex', 'pi']) {
    const manifest = await read(`../src-tauri/capability-plugins/${name}/plugin.json`);
    assert.equal(validate(manifest), true, JSON.stringify(validate.errors));
    const icon = manifest.contributions[0].icon;
    assert.deepEqual(readAgentIcon(icon), icon);
    for (const invalid of [{path: '<svg onload="alert(1)">'}, {path: 'https://example.com/icon.svg'}, {path: 'M' + '0'.repeat(8192)}, {path: 'M0 0Z', fill: 'red'}, {path: ''}, {path: 42}]) {
      const broken = structuredClone(manifest);
      broken.contributions[0].icon = invalid;
      assert.equal(validate(broken), false);
      assert.equal(readAgentIcon(invalid), undefined);
    }
  }
});

test('v2 structural schema admits declarative and executable contributions with distinct dependencies', () => {
  for (const value of [view, provider, dependent, chain, git, gitView, writer, writeChain]) assert.equal(validate(value), true, JSON.stringify(validate.errors));
  assert.equal('entrypoint' in view, false);
  assert.equal('dependencies' in provider, false);
});

test('v2 schema rejects incomplete executable packages, unknown surfaces and excessive contributions', () => {
  const missingEntry = structuredClone(provider); delete missingEntry.entrypoint;
  const missingRuntime = structuredClone(provider); missingRuntime.protocols = {};
  const wrongPoint = structuredClone(view); wrongPoint.contributions[0].extensionPoint = 'raw.html';
  const layout = structuredClone(view); layout.contributions[0].css = 'color:red';
  const legacyDependencies = structuredClone(view); legacyDependencies.dependencies = [];
  const oversized = structuredClone(view); oversized.contributions = Array(129).fill(view.contributions[0]);
  for (const value of [missingEntry, missingRuntime, wrongPoint, layout, legacyDependencies, oversized]) assert.equal(validate(value), false);
});
