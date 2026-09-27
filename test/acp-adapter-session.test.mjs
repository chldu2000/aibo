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
  constructor() { this.requests = []; this.responses = []; this.requestHandlers = []; this.notificationHandlers = []; this.closed = false; }
  start() { return this; }
  onRequest(handler) { this.requestHandlers.push(handler); return () => {}; }
  onNotification(handler) { this.notificationHandlers.push(handler); return () => {}; }
  async request(method, params) {
    this.requests.push({ method, params });
    if (method === 'initialize') return { protocolVersion: 1, agentCapabilities: { loadSession: true } };
    if (method === 'session/new') return { sessionId: 'echo-1', ...modes('ask') };
    if (method === 'session/load') return modes('ask');
    if (method === 'session/set_config_option') return { configOptions: [{ id: 'mode', currentValue: params.value }] };
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
function fixture() {
  const transport = new FakeTransport(), events = [];
  const session = new AcpSession({ extension, transportFactory: () => transport, emit: event => events.push(event) });
  return { transport, events, session };
}
const open = (session, overrides = {}) => session.open({ mode: 'create', workspaceId: 'w', workspacePath: '/w', executionProfile: profile('edit'), permissions: ['workspace.read'], ...overrides });

test('agents without an auth method skip authenticate and send no client extension metadata', async () => {
  const { transport, session } = fixture();
  const opened = await open(session);
  assert.deepEqual(transport.requests.map(request => request.method), ['initialize', 'session/new', 'session/set_config_option']);
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
