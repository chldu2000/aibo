import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import Ajv from 'ajv/dist/2020.js';
const schema = JSON.parse(await readFile(new URL('../contracts/capability-runtime.experimental.schema.json', import.meta.url), 'utf8'));
const validate = new Ajv({ strict: false }).compile(schema);
const call = { jsonrpc: '2.0', id: 'child', method: 'capability.call', params: { invocationId: 'parent', generationId: 'generation', pluginId: 'dev.aibo.leaf', contributionId: 'dev.aibo.leaf.read', capability: 'dev.aibo.leaf.echo', version: '1.0.0', input: { value: 'read' } } };
test('experimental capability transport admits bounded dependency requests and existing responses', () => {
  for (const message of [call, { jsonrpc: '2.0', id: 'reply', result: {} }, { jsonrpc: '2.0', id: 'reply', error: { code: -32000, message: 'Rejected', data: { kind: 'permission_denied' } } }]) assert.equal(validate(message), true);
});
test('dependency requests cannot supply scope, caller, permissions, release or deadline', () => {
  for (const key of ['scope', 'caller', 'permissions', 'installationId', 'workspacePath', 'deadlineUnixMs', 'callChain']) {
    const forged = structuredClone(call); forged.params[key] = 'forged';
    assert.equal(validate(forged), false, key);
  }
});
test('capability transport rejects mixed response/request envelopes and Agent tool requests', () => {
  for (const message of [{ ...call, result: {} }, { ...call, method: 'aibo/tool-request' }, { ...call, id: 'x'.repeat(161) }, { jsonrpc: '2.0', id: 'bad', result: {}, error: { code: -1, message: 'bad' } }]) assert.equal(validate(message), false);
});

test('capability error envelopes carry approval rejection and unknown write outcomes', () => {
  for (const kind of ['approval_rejected', 'outcome_unknown']) assert.equal(validate({ jsonrpc: '2.0', id: 'reply', error: { code: -32000, message: 'Dependency did not complete', data: { kind } } }), true);
});
