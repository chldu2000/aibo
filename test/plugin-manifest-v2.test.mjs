import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import Ajv from 'ajv/dist/2020.js';
const read = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const ajv = new Ajv({ strict: false, allErrors: true });
ajv.addFormat('uri', value => { try { return Boolean(new URL(value).protocol); } catch { return false; } });
const validate = ajv.compile(await read('../contracts/plugin-manifest.v2.schema.json'));
const view = await read('../fixtures/plugins/platform-v2/declarative.json');
const provider = await read('../fixtures/plugins/platform-v2/provider.json');

test('v2 structural schema admits declarative and executable contributions with distinct dependencies', () => {
  for (const value of [view, provider]) assert.equal(validate(value), true, JSON.stringify(validate.errors));
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
