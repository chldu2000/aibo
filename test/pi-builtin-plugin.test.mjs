import assert from 'node:assert/strict';
import { appendFile, chmod, copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { watch } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { JsonlProcess } from '../probes/lib/jsonl-process.mjs';

test('bundled Pi plugin translates RPC lifecycle into Agent Runtime v1', { concurrency: false }, async (t) => {
  if (process.platform === 'win32') return t.skip('Windows command shim coverage is tracked separately');
  const directory = await mkdtemp(path.join(tmpdir(), 'aibo-pi-plugin-'));
  const fake = path.join(directory, 'pi');
  await copyFile('fixtures/plugins/pi/fake-pi.mjs', fake); await chmod(fake, 0o755);
  const client = new JsonlProcess(process.execPath, ['src-tauri/builtin-plugins/pi/pi-plugin.mjs'], {
    cwd: process.cwd(), env: { ...process.env, PATH: `${directory}${path.delimiter}${process.env.PATH}`, AIBO_PI_PLUGIN_PROVIDER: 'rpc' },
  }).start();
  t.after(async () => { await client.close(); await rm(directory, { recursive: true, force: true }); });
  const messages = []; client.on('message', (message) => messages.push(message));
  const request = async (method, params) => (await client.requestMessage({ jsonrpc: '2.0', method, params })).result;
  await request('aibo.initialize', { runtimeInstanceId: 'runtime', generationId: 'generation',
    host: { appVersion: '0.1.0', platform: 'darwin-arm64', runtimeProtocolVersions: ['1.0'], viewProtocolVersions: ['1.0'] },
    expectedPlugin: { pluginId: 'dev.aibo.pi', pluginVersion: '1.0.0' },
    permissionGrants: [{ id: 'workspace.read', decision: 'granted', enforcement: 'agent-native', constraints: { roots: [directory] } }] });
  const scope = { agentId: 'dev.aibo.pi.agent', sessionId: 'session', workspace: { workspaceId: 'workspace', trusted: true, path: directory }, executionProfile: { runtimeDataPath: directory } };
  const session = await request('session.create', scope);
  assert.equal(session.nativeSessionId, 'native-pi-session');
  await assert.rejects(
    client.requestMessage({ jsonrpc: '2.0', method: 'turn.send', params: { agentId: scope.agentId, sessionId: scope.sessionId, turnId: 'failed-turn', input: { text: 'fail prompt', attachments: [] } } }),
    /fake prompt rejection/,
  );
  const completed = client.waitFor((message) => message.params?.type === 'turn.completed');
  await request('turn.send', { agentId: scope.agentId, sessionId: scope.sessionId, turnId: 'aibo-turn', input: { text: 'hello pi plugin', attachments: [] } });
  assert.equal((await completed).params.payload.status, 'completed');
  assert.equal(messages.filter((message) => message.params?.type === 'message.delta').map((message) => message.params.payload.delta).join(''), 'hello pi plugin');
  assert.ok(messages.some((message) => message.method === 'view/render' && message.params.document.viewId === 'dev.aibo.pi.status'));
  const operation = (operationId, input = {}) => request('operation.invoke', { agentId: scope.agentId, sessionId: scope.sessionId, operationId, input });
  assert.equal((await operation('ext.dev.aibo.pi.model', { action: 'list' })).output.models[0].id, 'model-1');
  assert.deepEqual((await operation('ext.dev.aibo.pi.reasoning', { action: 'list' })).output.levels, ['off', 'high']);
  await operation('ext.dev.aibo.pi.model', { action: 'set', provider: 'fake', modelId: 'model-1' });
  await operation('ext.dev.aibo.pi.reasoning', { action: 'set', level: 'high' });
  const recovery = messages.filter((message) => message.params?.type === 'session.info_changed').at(-1);
  assert.deepEqual(recovery.params.payload.recovery.data.model, { provider: 'fake', modelId: 'model-1' });
  assert.equal(recovery.params.payload.recovery.data.thinkingLevel, 'high');
  assert.equal((await operation('ext.dev.aibo.pi.commands')).output.commands[0].name, 'review');
  assert.equal((await operation('ext.dev.aibo.pi.queue', { action: 'steer', message: 'change direction' })).output.queued, 'change direction');
  assert.equal((await operation('ext.dev.aibo.pi.compact', { instructions: 'keep decisions' })).output.summary, 'keep decisions');
  assert.deepEqual((await operation('ext.dev.aibo.pi.tree', { action: 'get' })).output.tree, []);
  assert.equal((await operation('ext.dev.aibo.pi.tree', { action: 'navigate', entryId: 'branch-1', summarize: true, customInstructions: null })).output.leafId, 'branch-1');
  assert.deepEqual((await operation('ext.dev.aibo.pi.snapshot')).output, { tree: [], leafId: null, branch: [] });
  const multiMessageCompleted = client.waitFor((message) => message.params?.type === 'turn.completed' && message.params.turnId === 'multi-message-turn');
  await request('turn.send', { agentId: scope.agentId, sessionId: scope.sessionId, turnId: 'multi-message-turn', input: { text: 'two messages', attachments: [] } });
  await multiMessageCompleted;
  const multiMessages = messages.filter((message) => message.params?.type === 'message.completed' && message.params.turnId === 'multi-message-turn');
  assert.deepEqual(multiMessages.map((message) => [message.params.payload.itemId, message.params.payload.text]), [
    ['assistant-message-1', 'first message'], ['assistant-message-2', 'second message'],
  ]);
});

test('bundled Pi plugin isolates delayed old provider exit from replacement requests', { concurrency: false }, async (t) => {
  if (process.platform === 'win32') return t.skip('Windows command shim coverage is tracked separately');
  const directory = await mkdtemp(path.join(tmpdir(), 'aibo-pi-plugin-generation-'));
  const fake = path.join(directory, 'pi');
  const control = path.join(directory, 'provider-control.log');
  await copyFile('fixtures/plugins/pi/fake-pi.mjs', fake); await chmod(fake, 0o755); await writeFile(control, '');
  const client = new JsonlProcess(process.execPath, ['src-tauri/builtin-plugins/pi/pi-plugin.mjs'], {
    cwd: process.cwd(), env: { ...process.env, PATH: `${directory}${path.delimiter}${process.env.PATH}`, AIBO_FAKE_PI_PROVIDER: 'rpc', AIBO_PI_PLUGIN_PROVIDER: 'rpc', AIBO_FAKE_PI_CONTROL_FILE: control },
  }).start();
  t.after(async () => { await appendFile(control, 'release-old\nrelease-new\n').catch(() => {}); await client.close(); await rm(directory, { recursive: true, force: true }); });
  const request = async (method, params) => (await client.requestMessage({ jsonrpc: '2.0', method, params })).result;
  const waitForControl = async (marker) => {
    if ((await readFile(control, 'utf8')).includes(marker)) return;
    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearInterval(poll);
        watcher.close();
        if (error) reject(error); else resolve();
      };
      const check = async () => {
        if (!(await readFile(control, 'utf8')).includes(marker)) return;
        finish();
      };
      const timer = setTimeout(() => finish(new Error(`Timed out waiting for provider marker ${marker}`)), 5_000);
      const poll = setInterval(() => { void check(); }, 25);
      const watcher = watch(control, () => { void check(); });
    });
  };
  await request('aibo.initialize', { runtimeInstanceId: 'runtime', generationId: 'generation',
    host: { appVersion: '0.1.0', platform: 'darwin-arm64', runtimeProtocolVersions: ['1.0'], viewProtocolVersions: ['1.0'] },
    expectedPlugin: { pluginId: 'dev.aibo.pi', pluginVersion: '1.0.0' },
    permissionGrants: [{ id: 'workspace.read', decision: 'granted', enforcement: 'agent-native', constraints: { roots: [directory] } }] });
  const scope = { agentId: 'dev.aibo.pi.agent', sessionId: 'generation-session', workspace: { workspaceId: 'workspace', trusted: true, path: directory }, executionProfile: { runtimeDataPath: directory } };
  await request('session.create', scope);
  await request('session.close', { agentId: scope.agentId, sessionId: scope.sessionId });
  await waitForControl('sigterm:1');
  const replacement = client.requestMessage({ jsonrpc: '2.0', method: 'session.create', params: scope });
  await waitForControl('start:2:');
  await waitForControl('get_state:2');
  await appendFile(control, 'release-old\n');
  await waitForControl('exit:1');
  await appendFile(control, 'release-new\n');
  assert.equal((await replacement).result.nativeSessionId, 'native-pi-session');
});

test('bundled Pi plugin production path uses the locked SDK provider', { concurrency: false }, async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'aibo-pi-plugin-sdk-'));
  const client = new JsonlProcess(process.execPath, ['src-tauri/builtin-plugins/pi/pi-plugin.mjs'], {
    cwd: process.cwd(), env: { ...process.env },
  }).start();
  t.after(async () => { await client.close(); await rm(directory, { recursive: true, force: true }); });
  const request = async (method, params) => (await client.requestMessage({ jsonrpc: '2.0', method, params })).result;
  await request('aibo.initialize', { runtimeInstanceId: 'runtime', generationId: 'generation',
    host: { appVersion: '0.1.0', platform: 'darwin-arm64', runtimeProtocolVersions: ['1.0'], viewProtocolVersions: ['1.0'] },
    expectedPlugin: { pluginId: 'dev.aibo.pi', pluginVersion: '1.0.0' },
    permissionGrants: [{ id: 'workspace.read', decision: 'granted', enforcement: 'agent-native', constraints: { roots: [directory] } }] });
  const scope = { agentId: 'dev.aibo.pi.agent', sessionId: 'sdk-session', workspace: { workspaceId: 'workspace', trusted: true, path: directory }, executionProfile: { runtimeDataPath: directory } };
  const session = await request('session.create', scope);
  assert.ok(session.nativeSessionId);
  const commands = await request('operation.invoke', { agentId: scope.agentId, sessionId: scope.sessionId, operationId: 'ext.dev.aibo.pi.commands', input: {} });
  assert.ok(commands.output.commands.some((command) => command.name === 'compact'));
  const snapshot = await request('operation.invoke', { agentId: scope.agentId, sessionId: scope.sessionId, operationId: 'ext.dev.aibo.pi.snapshot', input: {} });
  assert.ok(Array.isArray(snapshot.output.tree));
  await request('session.close', { agentId: scope.agentId, sessionId: scope.sessionId });
});

test('bundled Pi SDK adapter keeps fallback message sequence identity without native IDs', { concurrency: false }, async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'aibo-pi-plugin-message-sequence-'));
  const fakeSdk = path.resolve('fixtures/pi/fake-sdk.mjs');
  const client = new JsonlProcess(process.execPath, ['src-tauri/builtin-plugins/pi/pi-plugin.mjs'], {
    cwd: process.cwd(), env: { ...process.env, AIBO_PI_SDK_MODULE: fakeSdk },
  }).start();
  t.after(async () => { await client.close(); await rm(directory, { recursive: true, force: true }); });
  const messages = [];
  client.on('message', (message) => messages.push(message));
  const request = async (method, params) => (await client.requestMessage({ jsonrpc: '2.0', method, params })).result;
  await request('aibo.initialize', {
    runtimeInstanceId: 'runtime', generationId: 'generation',
    host: { appVersion: '0.1.0', platform: 'darwin-arm64', runtimeProtocolVersions: ['1.0'], viewProtocolVersions: ['1.0'] },
    expectedPlugin: { pluginId: 'dev.aibo.pi', pluginVersion: '1.0.0' },
    permissionGrants: [{ id: 'workspace.read', decision: 'granted', enforcement: 'agent-native', constraints: { roots: [directory] } }],
  });
  const scope = { agentId: 'dev.aibo.pi.agent', sessionId: 'sequence-session', workspace: { workspaceId: 'workspace', trusted: true, path: directory }, executionProfile: { runtimeDataPath: directory } };
  await request('session.create', scope);
  const send = async (turnId, text) => {
    const completed = client.waitFor((message) => message.method === 'agent/event' && ['turn.completed', 'turn.failed'].includes(message.params.type) && message.params.turnId === turnId);
    await request('turn.send', { ...scope, turnId, input: { text, attachments: [] } });
    const terminal = await completed;
    assert.equal(terminal.params.type, 'turn.completed', JSON.stringify(messages));
  };
  await send('two-identical', 'two identical no ids');
  assert.deepEqual(messages.filter((message) => message.params?.type === 'message.completed' && message.params.turnId === 'two-identical')
    .map((message) => [message.params.payload.itemId, message.params.payload.text]), [
      ['assistant-1', 'same reply'], ['assistant-2', 'same reply'],
    ]);
  await send('missing-completion', 'missing completion');
  assert.deepEqual(messages.filter((message) => message.params?.type === 'message.completed' && message.params.turnId === 'missing-completion')
    .map((message) => message.params.payload.text), ['missing completion']);
  await send('late-completion', 'late completion');
  assert.deepEqual(messages.filter((message) => message.params?.type === 'message.completed' && message.params.turnId === 'late-completion')
    .map((message) => message.params.payload.text), ['late completion']);
  await request('session.close', { agentId: scope.agentId, sessionId: scope.sessionId });
});

test('bundled Pi SDK read tool stays on the Core gateway, including image detection', { concurrency: false }, async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'aibo-pi-plugin-core-read-'));
  const fakeSdk = path.resolve('fixtures/pi/fake-sdk.mjs');
  const client = new JsonlProcess(process.execPath, ['src-tauri/builtin-plugins/pi/pi-plugin.mjs'], {
    cwd: process.cwd(), env: { ...process.env, AIBO_PI_SDK_MODULE: fakeSdk },
  }).start();
  t.after(async () => { await client.close(); await rm(directory, { recursive: true, force: true }); });
  const messages = [];
  const coreRequests = [];
  client.on('message', (message) => {
    messages.push(message);
    if (message.method !== 'aibo/tool-request') return;
    coreRequests.push(message.params);
    const input = message.params.input;
    const result = input.action === 'image_mime'
      ? { path: input.path, mimeType: input.path.endsWith('read-tool.png') ? 'image/png' : null }
      : input.action === 'read' && input.path.endsWith('read-tool.png')
        ? { path: input.path, data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', encoding: 'base64', mimeType: 'image/png', bytes: 68 }
        : { path: input.path, content: 'Core mediated read', bytes: 19 };
    client.send({ id: message.id, result });
  });
  const request = async (method, params) => (await client.requestMessage({ jsonrpc: '2.0', method, params })).result;
  await request('aibo.initialize', {
    runtimeInstanceId: 'runtime', generationId: 'generation',
    host: { appVersion: '0.1.0', platform: 'darwin-arm64', runtimeProtocolVersions: ['1.0'], viewProtocolVersions: ['1.0'] },
    expectedPlugin: { pluginId: 'dev.aibo.pi', pluginVersion: '1.0.0' },
    permissionGrants: [{ id: 'workspace.read', decision: 'granted', enforcement: 'agent-native', constraints: { roots: [directory] } }],
  });
  const scope = { agentId: 'dev.aibo.pi.agent', sessionId: 'core-read-session', workspace: { workspaceId: 'workspace', trusted: true, path: directory }, executionProfile: { runtimeDataPath: directory } };
  await request('session.create', scope);
  const send = async (turnId, text) => {
    const completed = client.waitFor((message) => message.method === 'agent/event' && ['turn.completed', 'turn.failed'].includes(message.params.type) && message.params.turnId === turnId);
    await request('turn.send', { ...scope, turnId, input: { text, attachments: [] } });
    const terminal = await completed;
    assert.equal(terminal.params.type, 'turn.completed', JSON.stringify(messages));
  };
  await send('text-read', 'core plugin read fixture');
  await send('image-read', 'core plugin image fixture');
  const imageActions = coreRequests.filter((request) => request.turnId === 'image-read').map((request) => request.input.action);
  assert.deepEqual(imageActions, ['access', 'image_mime', 'read']);
  assert.ok(messages.some((message) => message.params?.type === 'tool.completed' && message.params.turnId === 'image-read'));
  await request('session.close', { agentId: scope.agentId, sessionId: scope.sessionId });
});

test('bundled Pi SDK write and bash tools are only wired through Core requests', { concurrency: false }, async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'aibo-pi-plugin-core-write-'));
  const fakeSdk = path.resolve('fixtures/pi/fake-sdk.mjs');
  const client = new JsonlProcess(process.execPath, ['src-tauri/builtin-plugins/pi/pi-plugin.mjs'], {
    cwd: process.cwd(), env: { ...process.env, AIBO_PI_SDK_MODULE: fakeSdk },
  }).start();
  t.after(async () => { await client.close(); await rm(directory, { recursive: true, force: true }); });
  const messages = [];
  const coreRequests = [];
  client.on('message', (message) => {
    messages.push(message);
    if (message.method !== 'aibo/tool-request') return;
    coreRequests.push(message.params);
    const input = message.params.input;
    const result = message.params.tool === 'write_file'
      ? { path: input.path, bytes: input.content.length, tool: 'write_file' }
      : { command: input.command, cwd: input.cwd, exitCode: 0, stdout: 'AIBO_PLUGIN_COMMAND_OK', stderr: '', output: 'AIBO_PLUGIN_COMMAND_OK' };
    client.send({ id: message.id, result });
  });
  const request = async (method, params) => (await client.requestMessage({ jsonrpc: '2.0', method, params })).result;
  await request('aibo.initialize', {
    runtimeInstanceId: 'runtime', generationId: 'generation',
    host: { appVersion: '0.1.0', platform: 'darwin-arm64', runtimeProtocolVersions: ['1.0'], viewProtocolVersions: ['1.0'] },
    expectedPlugin: { pluginId: 'dev.aibo.pi', pluginVersion: '1.0.0' },
    permissionGrants: [{ id: 'workspace.read', decision: 'granted', enforcement: 'agent-native', constraints: { roots: [directory] } }],
  });
  const scope = { agentId: 'dev.aibo.pi.agent', sessionId: 'core-write-session', workspace: { workspaceId: 'workspace', trusted: true, path: directory }, executionProfile: {
    runtimeDataPath: directory, interactionMode: 'edit', filesystemPolicy: 'workspace-write', commandPolicy: 'approved', approvalPolicy: 'on-request',
  } };
  await request('session.create', scope);
  const send = async (turnId, text) => {
    const completed = client.waitFor((message) => message.method === 'agent/event' && ['turn.completed', 'turn.failed'].includes(message.params.type) && message.params.turnId === turnId);
    await request('turn.send', { ...scope, turnId, input: { text, attachments: [] } });
    const terminal = await completed;
    assert.equal(terminal.params.type, 'turn.completed', JSON.stringify(messages));
  };
  await send('write-turn', 'core plugin write fixture');
  await send('bash-turn', 'core plugin bash fixture');
  assert.deepEqual(coreRequests.map((request) => request.tool), ['write_file', 'run_command']);
  assert.ok(messages.some((message) => message.params?.type === 'tool.completed' && message.params.turnId === 'write-turn'));
  assert.ok(messages.some((message) => message.params?.type === 'tool.completed' && message.params.turnId === 'bash-turn'));
  await request('session.close', { agentId: scope.agentId, sessionId: scope.sessionId });
});

test('bundled Pi SDK session resume reopens the native session file after a plugin restart', { concurrency: false }, async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'aibo-pi-plugin-recovery-'));
  const fakeSdk = path.resolve('fixtures/pi/fake-sdk.mjs');
  const clients = [];
  t.after(async () => {
    await Promise.all(clients.map((client) => client.close()));
    await rm(directory, { recursive: true, force: true });
  });
  const initialize = async (client) => (await client.requestMessage({ jsonrpc: '2.0', method: 'aibo.initialize', params: {
    runtimeInstanceId: 'runtime', generationId: 'generation',
    host: { appVersion: '0.1.0', platform: 'darwin-arm64', runtimeProtocolVersions: ['1.0'], viewProtocolVersions: ['1.0'] },
    expectedPlugin: { pluginId: 'dev.aibo.pi', pluginVersion: '1.0.0' },
    permissionGrants: [{ id: 'workspace.read', decision: 'granted', enforcement: 'agent-native', constraints: { roots: [directory] } }],
  } })).result;
  const start = () => {
    const client = new JsonlProcess(process.execPath, ['src-tauri/builtin-plugins/pi/pi-plugin.mjs'], {
      cwd: process.cwd(), env: { ...process.env, AIBO_PI_SDK_MODULE: fakeSdk },
    }).start();
    clients.push(client);
    return client;
  };
  const scope = { agentId: 'dev.aibo.pi.agent', sessionId: 'recovery-session', workspace: { workspaceId: 'workspace', trusted: true, path: directory }, executionProfile: { runtimeDataPath: directory } };
  const first = start();
  await initialize(first);
  const firstSession = (await first.requestMessage({ jsonrpc: '2.0', method: 'session.create', params: scope })).result;
  const firstCompleted = first.waitFor((message) => message.method === 'agent/event' && message.params.type === 'turn.completed');
  await first.requestMessage({ jsonrpc: '2.0', method: 'turn.send', params: { ...scope, turnId: 'recovery-turn', input: { text: 'persist this Pi session', attachments: [] } } });
  await firstCompleted;
  await first.requestMessage({ jsonrpc: '2.0', method: 'session.close', params: { agentId: scope.agentId, sessionId: scope.sessionId } });
  await first.requestMessage({ jsonrpc: '2.0', method: 'aibo.shutdown', params: {} });
  await first.close();

  const second = start();
  await initialize(second);
  const resumed = (await second.requestMessage({ jsonrpc: '2.0', method: 'session.resume', params: {
    ...scope, binding: { recovery: firstSession.recovery },
  } })).result;
  assert.equal(resumed.nativeSessionId, firstSession.nativeSessionId);
  const snapshot = (await second.requestMessage({ jsonrpc: '2.0', method: 'operation.invoke', params: {
    agentId: scope.agentId, sessionId: scope.sessionId, operationId: 'ext.dev.aibo.pi.snapshot', input: {},
  } })).result.output;
  assert.equal(snapshot.leafId, 'assistant-2');
  assert.ok(snapshot.tree.length >= 1, 'resume must restore the native session tree');
  await second.requestMessage({ jsonrpc: '2.0', method: 'session.close', params: { agentId: scope.agentId, sessionId: scope.sessionId } });
  await second.requestMessage({ jsonrpc: '2.0', method: 'aibo.shutdown', params: {} });
});

test('bundled Pi SDK abort closes the active turn and permits the next turn', { concurrency: false }, async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'aibo-pi-plugin-abort-'));
  const fakeSdk = path.resolve('fixtures/pi/fake-sdk.mjs');
  const client = new JsonlProcess(process.execPath, ['src-tauri/builtin-plugins/pi/pi-plugin.mjs'], {
    cwd: process.cwd(), env: { ...process.env, AIBO_PI_SDK_MODULE: fakeSdk },
  }).start();
  t.after(async () => { await client.close(); await rm(directory, { recursive: true, force: true }); });
  const request = async (method, params) => (await client.requestMessage({ jsonrpc: '2.0', method, params })).result;
  await request('aibo.initialize', {
    runtimeInstanceId: 'runtime', generationId: 'generation',
    host: { appVersion: '0.1.0', platform: 'darwin-arm64', runtimeProtocolVersions: ['1.0'], viewProtocolVersions: ['1.0'] },
    expectedPlugin: { pluginId: 'dev.aibo.pi', pluginVersion: '1.0.0' },
    permissionGrants: [{ id: 'workspace.read', decision: 'granted', enforcement: 'agent-native', constraints: { roots: [directory] } }],
  });
  const scope = { agentId: 'dev.aibo.pi.agent', sessionId: 'abort-session', workspace: { workspaceId: 'workspace', trusted: true, path: directory }, executionProfile: { runtimeDataPath: directory } };
  await request('session.create', scope);
  const interrupted = client.waitFor((message) => message.method === 'agent/event' && message.params.type === 'turn.completed' && message.params.turnId === 'abort-turn');
  await request('turn.send', { ...scope, turnId: 'abort-turn', input: { text: 'queue parity prompt', attachments: [] } });
  await request('turn.cancel', { ...scope, turnId: 'abort-turn' });
  assert.equal((await interrupted).params.payload.status, 'interrupted');
  const completed = client.waitFor((message) => message.method === 'agent/event' && message.params.type === 'turn.completed' && message.params.turnId === 'after-abort');
  await request('turn.send', { ...scope, turnId: 'after-abort', input: { text: 'after abort', attachments: [] } });
  assert.equal((await completed).params.payload.status, 'completed');
  await request('session.close', { agentId: scope.agentId, sessionId: scope.sessionId });
});
