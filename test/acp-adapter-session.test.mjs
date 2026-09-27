import test from 'node:test';
import assert from 'node:assert/strict';
import { AcpSession, BASE_CAPABILITIES } from '../packages/acp-adapter/session.mjs';

// A minimal non-Cursor agent: no authentication, persisted empty sessions, `code` as its write mode.
const extension = {
  label: 'Echo', command: 'echo-agent', recoverySchema: 'dev.example.echo.recovery', namespace: 'dev.example.echo', writableMode: 'code',
  validateExecutionProfile: (profile, permissions) => {
    if (!permissions.includes('workspace.read')) throw Object.assign(new Error('Echo requires workspace.read'), { kind: 'permission_denied' });
    return { mode: profile.interactionMode === 'edit' ? 'code' : 'ask', profile };
  },
};
const modes = current => ({ modes: { currentModeId: current, availableModes: [{ id: 'ask' }, { id: 'code' }] } });

class FakeTransport {
  constructor(agentCapabilities = { loadSession: true }) { this.agentCapabilities = agentCapabilities; this.requests = []; this.responses = []; this.requestHandlers = []; this.notificationHandlers = []; this.closed = false; }
  start() { return this; }
  onRequest(handler) { this.requestHandlers.push(handler); return () => {}; }
  onNotification(handler) { this.notificationHandlers.push(handler); return () => {}; }
  async request(method, params) {
    this.requests.push({ method, params });
    if (method === 'initialize') return { protocolVersion: 1, agentCapabilities: this.agentCapabilities };
    if (method === 'session/new') return { sessionId: 'echo-1', ...modes('ask') };
    if (method === 'session/load') return modes('ask');
    if (method === 'session/set_config_option') return { configOptions: [{ id: 'mode', currentValue: params.value }] };
    if (method === 'session/set_mode') return {};
    if (method === 'session/prompt') return new Promise(resolve => { this.finishPrompt = resolve; });
    throw new Error(`Unexpected request: ${method}`);
  }
  notify() {}
  respond(id, result) { this.responses.push({ id, result }); }
  emitRequest(message) { return this.requestHandlers.map(handler => handler(message)); }
  emitNotification(message) { for (const handler of this.notificationHandlers) handler(message); }
  async close() { this.closed = true; }
}

const profile = interactionMode => ({ schema: 'aibo.execution-profile/v1', interactionMode, approvalReviewer: 'user' });
function fixture(agentCapabilities) {
  const transport = new FakeTransport(agentCapabilities), events = [];
  const session = new AcpSession({ extension, transportFactory: () => transport, emit: event => events.push(event) });
  return { transport, events, session };
}
const open = (session, overrides = {}) => session.open({ mode: 'create', workspaceId: 'w', workspacePath: '/w', executionProfile: profile('edit'), permissions: ['workspace.read'], ...overrides });

test('agents without an auth method skip authenticate and send no client extension metadata', async () => {
  const { transport, session } = fixture();
  const opened = await open(session);
  // A modes-only agent switches with the standard session/set_mode request.
  assert.deepEqual(transport.requests.map(request => request.method), ['initialize', 'session/new', 'session/set_mode']);
  assert.deepEqual(transport.requests[2].params, { sessionId: 'echo-1', modeId: 'code' });
  const initialize = transport.requests[0].params;
  assert.equal(initialize.clientCapabilities._meta, undefined);
  assert.deepEqual(initialize.clientCapabilities.fs, { readTextFile: false, writeTextFile: false }, 'no client file or terminal tools');
  assert.equal(initialize.clientInfo.name, 'aibo-acp');
  assert.deepEqual(opened.capabilities, [...BASE_CAPABILITIES]);
  assert.equal(opened.recovery.schema, 'dev.example.echo.recovery');
});

test('agents that persist empty sessions load them on resume', async () => {
  const first = fixture();
  const { recovery } = await open(first.session);
  assert.equal(recovery.data.hasPrompt, false);
  await first.session.close();
  const second = fixture();
  await open(second.session, { mode: 'resume', recovery });
  assert.ok(second.transport.requests.some(request => request.method === 'session/load' && request.params.sessionId === 'echo-1'));
});

test('agents without native load support remain usable but never advertise resume', async () => {
  for (const agentCapabilities of [{ loadSession: false }, {}]) {
    const first = fixture(agentCapabilities);
    const opened = await open(first.session);
    assert.ok(!opened.capabilities.includes('session.resume'));
    assert.ok(!opened.capabilities.includes('user-input.respond'), 'vendor questions require an explicit extension');
    const turn = first.session.prompt({ text: 'hello', turnId: 't1', writable: true });
    first.transport.finishPrompt({ stopReason: 'end_turn' });
    const result = await turn;
    assert.equal(result.status, 'completed');
    await first.session.close();
    const second = fixture(agentCapabilities);
    await assert.rejects(open(second.session, { mode: 'resume', recovery: result.recovery }), /cannot restore ACP sessions/);
    assert.ok(!second.transport.requests.some(request => ['session/new', 'session/load'].includes(request.method)), 'never replace an unrestorable session');
  }
});

test('standard permission requests map to once options, and only the write mode asks the user', async () => {
  const { transport, events, session } = fixture();
  await open(session);
  const turn = session.prompt({ text: 'go', turnId: 't1', writable: true });
  const options = [{ optionId: 'yes', kind: 'allow_once' }, { optionId: 'always', kind: 'allow_always' }, { optionId: 'no', kind: 'reject_once' }];
  transport.emitRequest({ jsonrpc: '2.0', id: 7, method: 'session/request_permission', params: { sessionId: 'echo-1', options, toolCall: { toolCallId: 'c', kind: 'edit', title: 'Edit file' } } });
  const requested = events.find(event => event.type === 'approval.requested');
  assert.equal(requested.payload.requestId, 'acp-n-7');
  session.respondApproval('acp-n-7', 'accept');
  assert.deepEqual(transport.responses.at(-1), { id: 7, result: { outcome: { outcome: 'selected', optionId: 'yes' } } }, 'never the persistent allow_always');
  assert.throws(() => session.respondApproval('acp-n-7', 'accept'), /Echo approval request is no longer pending/);
  transport.finishPrompt({ stopReason: 'end_turn' });
  assert.equal((await turn).status, 'completed');

  const ask = fixture();
  await open(ask.session, { executionProfile: profile('ask') });
  const readOnly = ask.session.prompt({ text: 'look', turnId: 't2' });
  ask.transport.emitRequest({ jsonrpc: '2.0', id: 'x', method: 'session/request_permission', params: { sessionId: 'echo-1', options, toolCall: { toolCallId: 'c' } } });
  assert.deepEqual(ask.transport.responses.at(-1), { id: 'x', result: { outcome: { outcome: 'selected', optionId: 'no' } } }, 'read-only modes reject without asking');
  assert.ok(!ask.events.some(event => event.type === 'approval.requested'));
  ask.transport.finishPrompt({ stopReason: 'end_turn' });
  await readOnly;
});

test('vendor methods, updates and task tools fall back to generic behaviour without an extension hook', async () => {
  const { transport, events, session } = fixture();
  await open(session);
  const turn = session.prompt({ text: 'go', turnId: 't1', writable: true });
  assert.deepEqual(transport.emitRequest({ jsonrpc: '2.0', id: 9, method: 'vendor/ask', params: { sessionId: 'echo-1' } }), [false], 'the transport answers Method not found');
  assert.throws(() => session.respondUserInput('acp-n-9', {}), /Echo question is no longer pending/);
  transport.emitNotification({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'echo-1', update: { sessionUpdate: 'plan', entries: [] } } });
  assert.equal(events.at(-1).type, 'extension.updated');
  assert.equal(events.at(-1).payload.namespace, 'dev.example.echo');
  transport.emitNotification({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'echo-1', update: { sessionUpdate: 'tool_call', toolCallId: 'task-1', title: 'Task', rawInput: { _toolName: 'task' } } } });
  assert.equal(events.at(-1).type, 'tool.started', 'no subagent semantics without subagentFromTool');
  assert.equal(events.at(-1).payload.summary, 'Task');
  transport.emitNotification({ jsonrpc: '2.0', method: 'transport/closed', params: {} });
  assert.deepEqual(events.at(-1).payload, { message: 'Echo ACP exited' });
  transport.finishPrompt({ stopReason: 'end_turn' });
  await turn;
});

test('the default transport runs the extension command and names errors after the agent', async () => {
  const session = new AcpSession({ extension });
  let spawned;
  const transport = session.transportFactory({ cwd: '/w', spawnProcess: (command, args) => { spawned = [command, args]; throw new Error('stop'); } });
  assert.equal(transport.label, 'Echo ACP');
  assert.throws(() => transport.start(), /stop/);
  assert.deepEqual(spawned, ['echo-agent', []]);
  await assert.rejects(session.prompt({ text: 'x', turnId: 't' }), /Echo session is not ready/);
});

test('parameter capabilities follow the options the agent returned unless it declares a per-model picker', async () => {
  const configOptions = [
    { id: 'model', category: 'model', type: 'select', currentValue: 'm1', options: [{ value: 'm1' }, { value: 'm2' }] },
    { id: 'effort', category: 'thought_level', type: 'select', currentValue: 'low', options: [{ value: 'low' }, { value: 'high' }] },
  ];
  class ConfigTransport extends FakeTransport {
    async request(method, params) {
      if (method === 'session/new') { this.requests.push({ method, params }); return { sessionId: 'echo-1', ...modes('ask'), configOptions }; }
      return super.request(method, params);
    }
  }
  const capabilities = async picker => {
    const session = new AcpSession({ extension: { ...extension, parameterizedPicker: picker }, transportFactory: () => new ConfigTransport() });
    return (await open(session)).capabilities;
  };
  const plain = await capabilities(false);
  assert.ok(plain.includes('model.select') && plain.includes('model.reasoning'));
  assert.ok(!plain.includes('model.context-window'), 'no context option, no context-window capability');
  assert.ok((await capabilities(true)).includes('model.context-window'), 'a per-model picker claims both');
});

test('option approvals offer only once options and answer by option ID', async () => {
  const transport = new FakeTransport(), events = [];
  const session = new AcpSession({ extension: { ...extension, approvalOptions: true }, transportFactory: () => transport, emit: event => events.push(event) });
  await open(session);
  const turn = session.prompt({ text: 'go', turnId: 't1', writable: true });
  const options = [{ optionId: 'yes', kind: 'allow_once' }, { optionId: 'always', kind: 'allow_always' }, { optionId: 'no', kind: 'reject_once' }, { optionId: 'never', kind: 'reject_always' }];
  transport.emitRequest({ jsonrpc: '2.0', id: 3, method: 'session/request_permission', params: { sessionId: 'echo-1', options, toolCall: { toolCallId: 'c', kind: 'edit' } } });
  const requested = events.find(event => event.type === 'approval.requested');
  assert.deepEqual(requested.payload.options, [{ id: 'yes', kind: 'allow' }, { id: 'no', kind: 'reject' }]);
  assert.throws(() => session.respondApproval('acp-n-3', { optionId: 'always' }), /approval option is not offered/);
  session.respondApproval('acp-n-3', { optionId: 'no' });
  assert.deepEqual(transport.responses.at(-1), { id: 3, result: { outcome: { outcome: 'selected', optionId: 'no' } } });
  assert.equal(events.at(-1).payload.decision, 'cancel');
  transport.finishPrompt({ stopReason: 'end_turn' });
  await turn;
});
