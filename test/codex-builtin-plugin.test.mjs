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
  assert.ok(initialized.agents[0].capabilities.includes('approval.respond'));
  assert.ok(initialized.agents[0].capabilities.includes('user-input.respond'));
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
  const recovery = messages.filter((message) => message.params?.type === 'session.info_changed').at(-1);
  assert.deepEqual(recovery.params.payload.recovery.data, {
    threadId: 'native-thread', model: 'gpt-fake', reasoningEffort: 'high',
  });
  assert.equal((await operation('ext.dev.aibo.codex.skills')).output.skills[0].name, 'review');
  const configured = client.waitFor((message) => message.params?.type === 'turn.completed' && message.params.turnId === 'configured-turn');
  await request('turn.send', { agentId: scope.agentId, sessionId: scope.sessionId, turnId: 'configured-turn', input: { text: 'selected config', attachments: [] } });
  assert.equal((await configured).params.payload.status, 'completed');
  const toolDone = client.waitFor((message) => message.params?.type === 'turn.completed' && message.params.turnId === 'tool-turn');
  await request('turn.send', { agentId: scope.agentId, sessionId: scope.sessionId, turnId: 'tool-turn', input: { text: 'tool please', attachments: [] } });
  await toolDone;
  const toolEvents = messages.filter((message) => message.params?.turnId === 'tool-turn' && message.params?.type?.startsWith('tool.'));
  assert.deepEqual(toolEvents.map((message) => message.params.type), ['tool.started', 'tool.updated', 'tool.completed']);
  assert.equal(toolEvents.at(-1).params.payload.itemId, 'command-1');
  assert.equal(toolEvents.at(-1).params.payload.output, 'tool output\n');
  const reasoningEvents = messages.filter((message) => message.params?.turnId === 'tool-turn' && message.params?.type?.startsWith('reasoning.'));
  assert.deepEqual(reasoningEvents.map((message) => message.params.type), ['reasoning.updated', 'reasoning.completed']);
  assert.equal(reasoningEvents.at(-1).params.payload.summary, 'Checking the workspace.');
  const orderedCards = messages.filter((message) => message.params?.turnId === 'tool-turn' && ['message.completed', 'tool.started'].includes(message.params?.type));
  assert.deepEqual(orderedCards.map((message) => [message.params.type, message.params.payload.itemId]), [
    ['message.completed', 'commentary-1'], ['tool.started', 'command-1'], ['message.completed', 'message'],
  ]);
  const approval = client.waitFor((message) => message.params?.type === 'approval.requested');
  const approvalDone = client.waitFor((message) => message.params?.type === 'turn.completed' && message.params.turnId === 'approval-turn');
  await request('turn.send', { agentId: scope.agentId, sessionId: scope.sessionId, turnId: 'approval-turn', input: { text: 'approval please', attachments: [] } });
  assert.equal((await approval).params.payload.requestId, 'provider-approval');
  assert.equal((await operation('ext.dev.aibo.codex.approval', { requestId: 'provider-approval', decision: 'accept' })).output.resolved, true);
  await approvalDone;
  const userInput = client.waitFor((message) => message.params?.type === 'user_input.requested');
  const inputDone = client.waitFor((message) => message.params?.type === 'turn.completed' && message.params.turnId === 'input-turn');
  await request('turn.send', { agentId: scope.agentId, sessionId: scope.sessionId, turnId: 'input-turn', input: { text: 'input please', attachments: [] } });
  assert.equal((await userInput).params.payload.questions[0].id, 'choice');
  assert.equal((await operation('ext.dev.aibo.codex.user-input', { requestId: 'provider-input', answers: { choice: ['yes'] } })).output.resolved, true);
  await inputDone;
});

test('bundled Codex plugin recreates a thread whose first rollout was never materialized', async (t) => {
  if (process.platform === 'win32') return t.skip('Windows command shim coverage is tracked separately');
  const directory = await mkdtemp(path.join(tmpdir(), 'aibo-codex-plugin-recovery-'));
  const fake = path.join(directory, 'codex');
  await copyFile('fixtures/plugins/codex/fake-codex.mjs', fake);
  await chmod(fake, 0o755);
  const client = new JsonlProcess(process.execPath, ['src-tauri/builtin-plugins/codex/codex-plugin.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PATH: `${directory}${path.delimiter}${process.env.PATH}`,
      CODEX_FAKE_MISSING_ROLLOUT: '1',
      CODEX_FAKE_THREAD_ID: 'replacement-thread',
    },
  }).start();
  t.after(async () => { await client.close(); await rm(directory, { recursive: true, force: true }); });
  const request = async (method, params) => (await client.requestMessage({ jsonrpc: '2.0', method, params })).result;
  await request('aibo.initialize', {
    runtimeInstanceId: 'runtime',
    generationId: 'generation',
    host: { appVersion: '0.1.0', platform: 'darwin-arm64', runtimeProtocolVersions: ['1.0'], viewProtocolVersions: ['1.0'] },
    expectedPlugin: { pluginId: 'dev.aibo.codex', pluginVersion: '1.0.0' },
    permissionGrants: [{ id: 'workspace.read', decision: 'granted', enforcement: 'agent-native', constraints: { roots: [directory] } }],
  });
  const scope = {
    agentId: 'dev.aibo.codex.agent',
    sessionId: 'recovery-session',
    workspace: { workspaceId: 'workspace', trusted: true, path: directory },
    executionProfile: { approvalPolicy: 'never', filesystemPolicy: 'danger-full-access' },
  };
  const created = await request('session.create', scope);
  assert.equal(created.nativeSessionId, 'replacement-thread');
  await request('session.close', { agentId: scope.agentId, sessionId: scope.sessionId });
  const resumed = await request('session.resume', {
    ...scope,
    binding: {
      pluginId: 'dev.aibo.codex',
      recovery: {
        schema: 'dev.aibo.codex.recovery',
        version: 1,
        data: { threadId: created.nativeSessionId, model: 'gpt-fake', reasoningEffort: 'high' },
      },
    },
  });
  assert.equal(resumed.nativeSessionId, 'replacement-thread');
  assert.deepEqual(resumed.recovery.data, {
    threadId: 'replacement-thread',
    model: 'gpt-fake',
    reasoningEffort: 'high',
  });
  const catalog = await request('operation.invoke', {
    agentId: scope.agentId,
    sessionId: scope.sessionId,
    operationId: 'ext.dev.aibo.codex.model',
    input: { action: 'list' },
  });
  assert.equal(catalog.output.models[0].id, 'gpt-fake');
});
