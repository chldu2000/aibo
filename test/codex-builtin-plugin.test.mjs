import assert from 'node:assert/strict';
import { chmod, copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { JsonlProcess } from '../probes/lib/jsonl-process.mjs';

test('bundled Codex plugin translates app-server lifecycle into Agent Runtime v1', async (t) => {
  if (process.platform === 'win32') return t.skip('Windows command shim coverage is tracked separately');
  const directory = await mkdtemp(path.join(tmpdir(), 'aibo-codex-plugin-'));
  const fake = path.join(directory, process.platform === 'win32' ? 'codex.cmd' : 'codex');
  await copyFile('fixtures/plugins/codex/fake-codex.mjs', fake);
  await chmod(fake, 0o755);
  const client = new JsonlProcess(process.execPath, ['src-tauri/builtin-plugins/codex/codex-plugin.mjs'], {
    cwd: process.cwd(), env: { ...process.env, PATH: `${directory}${path.delimiter}${process.env.PATH}` },
  }).start();
  t.after(async () => { await client.close(); await rm(directory, { recursive: true, force: true }); });
  const messages = [];
  client.on('message', (message) => messages.push(message));
  const request = async (method, params) => (await client.requestMessage({ jsonrpc: '2.0', method, params })).result;
  const initialized = await request('aibo.initialize', { runtimeInstanceId: 'runtime', generationId: 'generation',
    host: { appVersion: '0.1.0', platform: 'darwin-arm64', runtimeProtocolVersions: ['1.0'], viewProtocolVersions: ['1.0'] },
    expectedPlugin: { pluginId: 'dev.aibo.codex', pluginVersion: '1.0.0' },
    permissionGrants: [{ id: 'workspace.read', decision: 'granted', enforcement: 'agent-native', constraints: { roots: [directory] } }] });
  assert.equal(initialized.pluginId, 'dev.aibo.codex');
  const scope = { agentId: 'dev.aibo.codex.agent', sessionId: 'session', workspace: { workspaceId: 'workspace', trusted: true, path: directory }, executionProfile: {} };
  const session = await request('session.create', scope);
  assert.equal(session.nativeSessionId, 'native-thread');
  const completed = client.waitFor((message) => message.params?.type === 'turn.completed');
  await request('turn.send', { agentId: scope.agentId, sessionId: scope.sessionId, turnId: 'aibo-turn', input: { text: 'hello plugin', attachments: [] } });
  assert.equal((await completed).params.payload.status, 'completed');
  assert.equal(messages.filter((message) => message.params?.type === 'message.delta').map((message) => message.params.payload.delta).join(''), 'hello plugin');
  assert.ok(messages.some((message) => message.method === 'view/render' && message.params.document.viewId === 'dev.aibo.codex.status'));
  const selected = await request('operation.invoke', { agentId: scope.agentId, sessionId: scope.sessionId,
    operationId: 'ext.dev.aibo.codex.goal', input: { action: 'set', objective: 'Finish P4.7', tokenBudget: 2048 } });
  assert.deepEqual(selected, { kind: 'operation', operationId: 'ext.dev.aibo.codex.goal', output: {
    goal: { objective: 'Finish P4.7', tokenBudget: 2048, status: 'active' },
  } });
  const cleared = await request('operation.invoke', { agentId: scope.agentId, sessionId: scope.sessionId,
    operationId: 'ext.dev.aibo.codex.goal', input: { action: 'clear' } });
  assert.equal(cleared.output.goal, null);
  const operation = (operationId, input = {}) => request('operation.invoke', { agentId: scope.agentId, sessionId: scope.sessionId, operationId, input });
  assert.equal((await operation('ext.dev.aibo.codex.model', { action: 'set', reference: 'gpt-fake' })).output.current, 'gpt-fake');
  assert.equal((await operation('ext.dev.aibo.codex.reasoning', { action: 'set', level: 'high' })).output.current, 'high');
  assert.equal((await operation('ext.dev.aibo.codex.skills')).output.skills[0].name, 'review');
  const configured = client.waitFor((message) => message.params?.type === 'turn.completed' && message.params.turnId === 'configured-turn');
  await request('turn.send', { agentId: scope.agentId, sessionId: scope.sessionId, turnId: 'configured-turn', input: { text: 'selected config', attachments: [] } });
  assert.equal((await configured).params.payload.status, 'completed');
});
