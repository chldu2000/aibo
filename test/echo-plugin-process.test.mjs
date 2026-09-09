import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { JsonlProcess } from '../probes/lib/jsonl-process.mjs';

const agentId = 'dev.aibo.echo.agent';
const scope = { agentId, sessionId: 'session-echo-test', workspace: { workspaceId: 'test', trusted: true }, executionProfile: {} };
async function start(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'aibo-external-echo-'));
  await cp('fixtures/plugins/echo-agent/echo-agent.mjs', path.join(directory, 'echo-agent.mjs'));
  const client = new JsonlProcess(process.execPath, ['echo-agent.mjs'], { cwd: directory }).start();
  t.after(async () => { await client.close(); await rm(directory, { recursive: true, force: true }); });
  const messages = [];
  client.on('message', (message) => messages.push(message));
  const request = async (method, params) => (await client.requestMessage({ jsonrpc: '2.0', method, params })).result;
  const initialize = (expectedPlugin = { pluginId: 'dev.aibo.echo', pluginVersion: '1.0.0' }) => request('aibo.initialize', {
    runtimeInstanceId: 'test-runtime', generationId: 'test-generation', expectedPlugin,
    host: { appVersion: '0.1.0', platform: 'windows-x64', runtimeProtocolVersions: ['1.0'], viewProtocolVersions: ['1.0'] }, permissionGrants: [],
  });
  return { client, request, initialize, messages };
}

test('external Echo process creates, streams Unicode, renders, cancels and resumes in a new process', async (t) => {
  const first = await start(t);
  assert.equal((await first.initialize()).kind, 'initialized');
  assert.equal((await first.request('aibo.diagnose', { agentId, workspace: scope.workspace })).status, 'ready');
  const session = await first.request('session.create', scope);
  const text = '你好 🌍\u2028aibo';
  const completed = first.client.waitFor((m) => m.params?.type === 'turn.completed' && m.params.turnId === 'one');
  await first.request('turn.send', { agentId, sessionId: scope.sessionId, turnId: 'one', input: { text, attachments: [] } });
  assert.equal((await completed).params.payload.status, 'completed');
  assert.equal(first.messages.filter((m) => m.params?.type === 'message.delta').map((m) => m.params.payload.delta).join(''), text);
  assert.ok(first.messages.some((m) => m.method === 'view/render' && m.params.document.root.type === 'panel'));
  assert.deepEqual(await first.request('operation.invoke', { agentId, sessionId: scope.sessionId, operationId: 'ext.dev.aibo.echo.refresh', input: { label: 'manual' } }), { kind: 'operation', operationId: 'ext.dev.aibo.echo.refresh', output: { cursor: 1 } });
  const cancelled = first.client.waitFor((m) => m.params?.type === 'turn.completed' && m.params.turnId === 'two');
  await first.request('turn.send', { agentId, sessionId: scope.sessionId, turnId: 'two', input: { text: 'long '.repeat(100), attachments: [] } });
  await first.request('turn.cancel', { agentId, sessionId: scope.sessionId, turnId: 'two', reason: 'user' });
  assert.equal((await cancelled).params.payload.status, 'interrupted');
  await first.request('turn.cancel', { agentId, sessionId: scope.sessionId, turnId: 'two', reason: 'user' });
  assert.equal(first.messages.filter((m) => m.params?.type === 'turn.completed' && m.params.turnId === 'two').length, 1);
  await first.request('aibo.shutdown', { reason: 'restart' });
  await first.client.close();

  const second = await start(t);
  await second.initialize();
  const binding = { schema: 'aibo.plugin-session-binding/v1', sessionId: scope.sessionId, pluginInstallationId: 'test-install',
    pluginId: 'dev.aibo.echo', pluginVersion: '1.0.0', agentId, nativeSessionId: session.nativeSessionId,
    runtimeProtocolVersion: '1.0', recovery: session.recovery, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  const restored = await second.request('session.resume', { ...scope, binding });
  assert.equal(restored.nativeSessionId, session.nativeSessionId);
  const resumedTurn = second.client.waitFor((m) => m.params?.type === 'turn.completed');
  await second.request('turn.send', { agentId, sessionId: scope.sessionId, turnId: 'three', input: { text: 'resumed', attachments: [] } });
  assert.equal((await resumedTurn).params.payload.status, 'completed');
});

test('Echo rejects uninitialized calls, wrong releases, unsupported recovery and cross-session cancellation', async (t) => {
  const { request, initialize } = await start(t);
  await assert.rejects(request('session.create', scope), /not_initialized/);
  await assert.rejects(initialize({ pluginId: 'dev.aibo.other', pluginVersion: '1.0.0' }), /manifest_mismatch/);
  await initialize();
  await assert.rejects(request('session.resume', { ...scope, binding: {} }), /invalid_recovery_data/);
  await request('session.create', scope);
  await assert.rejects(request('turn.cancel', { agentId, sessionId: 'another-session', turnId: 'one' }), /invalid_session/);
  await assert.rejects(request('turn.send', { agentId, sessionId: scope.sessionId, turnId: 'one', input: { text: 'x', attachments: [{}] } }), /invalid_request/);
});
