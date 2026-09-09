import assert from 'node:assert/strict';
import { appendFile, chmod, copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { watch } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { JsonlProcess } from '../probes/lib/jsonl-process.mjs';

test('bundled Pi plugin translates RPC lifecycle into Agent Runtime v1', async (t) => {
  if (process.platform === 'win32') return t.skip('Windows command shim coverage is tracked separately');
  const directory = await mkdtemp(path.join(tmpdir(), 'aibo-pi-plugin-'));
  const fake = path.join(directory, 'pi');
  await copyFile('fixtures/plugins/pi/fake-pi.mjs', fake); await chmod(fake, 0o755);
  const client = new JsonlProcess(process.execPath, ['src-tauri/builtin-plugins/pi/pi-plugin.mjs'], {
    cwd: process.cwd(), env: { ...process.env, PATH: `${directory}${path.delimiter}${process.env.PATH}` },
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
});

test('bundled Pi plugin isolates delayed old provider exit from replacement requests', async (t) => {
  if (process.platform === 'win32') return t.skip('Windows command shim coverage is tracked separately');
  const directory = await mkdtemp(path.join(tmpdir(), 'aibo-pi-plugin-generation-'));
  const fake = path.join(directory, 'pi');
  const control = path.join(directory, 'provider-control.log');
  await copyFile('fixtures/plugins/pi/fake-pi.mjs', fake); await chmod(fake, 0o755); await writeFile(control, '');
  const client = new JsonlProcess(process.execPath, ['src-tauri/builtin-plugins/pi/pi-plugin.mjs'], {
    cwd: process.cwd(), env: { ...process.env, PATH: `${directory}${path.delimiter}${process.env.PATH}`, AIBO_FAKE_PI_CONTROL_FILE: control },
  }).start();
  t.after(async () => { await appendFile(control, 'release-old\nrelease-new\n').catch(() => {}); await client.close(); await rm(directory, { recursive: true, force: true }); });
  const request = async (method, params) => (await client.requestMessage({ jsonrpc: '2.0', method, params })).result;
  const waitForControl = async (marker) => {
    if ((await readFile(control, 'utf8')).includes(marker)) return;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { watcher.close(); reject(new Error(`Timed out waiting for provider marker ${marker}`)); }, 5_000);
      const watcher = watch(control, async () => {
        if (!(await readFile(control, 'utf8')).includes(marker)) return;
        clearTimeout(timer); watcher.close(); resolve();
      });
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
