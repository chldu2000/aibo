import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sessionCapability } from './helpers/session-capability.mjs';

// A configuration-only plugin: plugin.json, acp.json and a one-line worker on the host SDK.
const plugin = 'fixtures/plugins/acp-echo';
const feature = name => `dev.example.acp-echo.${name}`;
const base = { schema: 'aibo.execution-profile/v1', networkPolicy: 'agent-managed', model: null, reasoningEffort: null };
const ask = { ...base, interactionMode: 'ask', filesystemPolicy: 'read-only', commandPolicy: 'disabled', approvalPolicy: 'never', approvalReviewer: 'none' };
const edit = { ...base, interactionMode: 'edit', filesystemPolicy: 'agent-managed', commandPolicy: 'agent-managed', approvalPolicy: 'on-request', approvalReviewer: 'user' };
const write = ['workspace.read', 'workspace.write'];
const messages = f => f.events.filter(entry => entry.event.type === 'message.completed').map(entry => entry.event.payload.text);

test('capabilities follow the native handshake and a modes-only agent switches with session/set_mode', async t => {
  const f = await sessionCapability(t, plugin, { ECHO_LOAD: '0' });
  const opened = await f.invoke('aibo.session.open', { mode: 'create', executionProfile: ask });
  assert.equal(opened.nativeSessionId, 'echo-1');
  assert.deepEqual(opened.capabilities.sort(), ['approval.respond', 'command.list', 'model.select', 'session.close', 'session.create', 'stream.text', 'turn.cancel', 'turn.send']);
  assert.equal(opened.recovery.schema, 'dev.example.acp-echo.recovery');
  assert.deepEqual((await f.invoke(feature('command.list'), { action: 'get' })).commands.map(command => command.insertionText), ['/echo-help ']);
  const models = await f.invoke(feature('model.select'), { action: 'set', reference: 'echo-large' });
  assert.equal(models.current, 'echo-large');
  const turn = f.startTurn('hello');
  assert.equal((await turn.done).status, 'completed');
  assert.deepEqual(messages(f), ['echo: hello']);
});

test('write turns ask the user, answer with the once option, and unknown vendor methods get Method not found', async t => {
  const f = await sessionCapability(t, plugin);
  await f.invoke('aibo.session.open', { mode: 'create', executionProfile: edit });
  const approval = f.wait('approval.requested');
  const turn = f.startTurn('permission vendor', 'turn-1', 'aibo.session.turn.write', write);
  const requested = await approval;
  assert.equal(requested.payload.requestId, 'acp-s-agent-1');
  // The fixture declares the option variant of approval.respond: only once options are offered.
  assert.deepEqual(requested.payload.options, [{ id: 'yes', kind: 'allow' }, { id: 'no', kind: 'reject' }]);
  await f.control(turn, feature('approval.respond'), { requestId: requested.payload.requestId, optionId: 'yes' });
  assert.equal((await turn.done).status, 'completed');
  assert.deepEqual(messages(f), ['echo: permission vendor permission:yes vendor:-32601'], 'never allow_always; the client does not implement echo/ask');
  await assert.rejects(f.invoke('aibo.session.turn', { text: 'read only' }, 'turn-2'), /write-authorized turn/, 'the write mode needs a write turn');
});

test('agents with load and image support resume across processes and receive image blocks', async t => {
  const env = { ECHO_LOAD: '1', ECHO_IMAGE: '1', ECHO_MODE_API: 'config' };
  const f = await sessionCapability(t, plugin, env);
  const opened = await f.invoke('aibo.session.open', { mode: 'create', executionProfile: ask });
  assert.ok(opened.capabilities.includes('session.resume') && opened.capabilities.includes('image.input'));
  const png = path.join(f.directory, 'shot.png');
  await writeFile(png, Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(24)]));
  const turn = f.request('aibo.session.turn', { text: 'look', attachments: [{ attachmentId: 'a', type: 'image', path: png, mimeType: 'image/png' }] }, 'turn-1');
  assert.equal((await f.rpc('capability.invoke', turn)).output.status, 'completed');
  assert.deepEqual(messages(f), ['echo: look image:image/png:32']);
  const restarted = await f.restart();
  const resumed = await restarted.invoke('aibo.session.open', { mode: 'resume', executionProfile: ask, recovery: opened.recovery });
  assert.equal(resumed.nativeSessionId, 'echo-1');

  const plain = await sessionCapability(t, plugin, { ECHO_IMAGE: '0' });
  await plain.invoke('aibo.session.open', { mode: 'create', executionProfile: ask });
  const rejected = plain.request('aibo.session.turn', { text: 'look', attachments: [{ attachmentId: 'a', type: 'image', path: png, mimeType: 'image/png' }] }, 'turn-1');
  await assert.rejects(plain.rpc('capability.invoke', rejected), /does not advertise image input/);
});

test('declared host tools reach a configuration-only agent through the SDK MCP bridge', async t => {
  const hostTools = JSON.parse(await readFile('contracts/host-tools.v1.json', 'utf8'));
  const f = await sessionCapability(t, plugin, {}, undefined, undefined, hostTools);
  const opened = await f.invoke('aibo.session.open', { mode: 'create', executionProfile: ask });
  assert.ok(opened.capabilities.includes('host-tools'));
  assert.match(opened.recovery.data.hostMcpServerName, /^aibo-[a-f0-9]{16}$/);
  const turn = f.startTurn('mcp');
  assert.equal((await turn.done).status, 'completed');
  assert.deepEqual(messages(f), ['echo: mcp mcp:1']);
  await f.invoke('aibo.session.close', {});
});

test('cancel interrupts a waiting turn', async t => {
  const f = await sessionCapability(t, plugin);
  await f.invoke('aibo.session.open', { mode: 'create', executionProfile: ask });
  const turn = f.startTurn('wait');
  await f.wait('turn.started');
  await f.control(turn, 'aibo.session.cancel', {});
  assert.equal((await turn.done).status, 'interrupted');
});

test('an invalid acp.json stops the worker before the Runtime handshake', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'aibo-acp-invalid-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'acp-echo');
  await cp(plugin, source, { recursive: true });
  const config = JSON.parse(await readFile(path.join(source, 'acp.json'), 'utf8'));
  await writeFile(path.join(source, 'acp.json'), JSON.stringify({ ...config, command: 'sh' }));
  await assert.rejects(sessionCapability(t, source), error => /exit|closed|Invalid acp\.json/i.test(String(error)));
});
