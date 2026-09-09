import { spawn, spawnSync } from 'node:child_process';
import readline from 'node:readline';

const pluginId = 'dev.aibo.pi';
const pluginVersion = '1.0.0';
const agentId = 'dev.aibo.pi.agent';
const capabilities = ['session.create', 'session.resume', 'session.close', 'turn.send', 'turn.cancel', 'stream.text', 'view.standard', 'model.select', 'model.reasoning', 'command.list', 'queue.manage', 'compaction.run', 'session.tree'];
let initialized = false;
let workspaceRoots = [];
let child = null;
let lines = null;
let nextId = 1;
let session = null;
const pending = new Map();

const write = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
const respond = (id, result) => write({ id, result });
const fail = (kind, message = kind) => { throw Object.assign(new Error(message), { kind }); };
const emit = (type, payload, turnId = null, correlation = null) => write({ method: 'agent/event', params: {
  agentId, sessionId: session.id, nativeSessionId: session.nativeId, turnId, type, correlation, payload,
} });
function render() {
  write({ method: 'view/render', params: { agentId, sessionId: session.id, document: {
    schema: 'aibo.plugin-view/v1', viewId: 'dev.aibo.pi.status', revision: ++session.revision,
    title: 'Pi status', data: {}, bindings: [], actions: [], resources: [], root: {
      id: 'status', type: 'panel', props: { title: 'Pi' }, children: [
        { id: 'state', type: 'badge', props: { text: session.turn ? 'Running' : 'Ready', tone: 'info' }, children: [] },
        { id: 'native', type: 'text', props: { text: `Session: ${session.nativeId}` }, children: [] }
      ]
    }
  } } });
}
function rpc(type, fields = {}) {
  const id = `pi-${nextId++}`;
  child.stdin.write(`${JSON.stringify({ id, type, ...fields })}\n`);
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
function visibleText(message) {
  if (!message || message.role !== 'assistant' || !Array.isArray(message.content)) return '';
  return message.content.filter((part) => part?.type === 'text').map((part) => part.text ?? '').join('');
}
function recovery() {
  return { schema: 'dev.aibo.pi.recovery', version: 1, data: {
    nativeSessionId: session.nativeId,
    sessionFile: session.sessionFile,
    model: session.model,
    thinkingLevel: session.thinkingLevel,
  } };
}
async function updateRecovery() {
  if (!session || !child) return;
  try {
    const state = await rpc('get_state');
    session.sessionFile = state.data?.sessionFile ?? session.sessionFile;
    emit('session.info_changed', { recovery: recovery() });
  } catch {}
}
function onPi(message) {
  if (message.id !== undefined && pending.has(String(message.id))) {
    const request = pending.get(String(message.id)); pending.delete(String(message.id));
    message.success === false ? request.reject(new Error(message.error ?? 'Pi request failed')) : request.resolve(message);
    return;
  }
  const turn = session?.turn;
  if (!turn) return;
  if (message.type === 'message_update' && message.assistantMessageEvent?.type === 'text_delta') {
    const delta = message.assistantMessageEvent.delta ?? '';
    if (delta) { turn.text += delta; emit('message.delta', { delta }, turn.id, { requestId: turn.requestId, itemId: null }); }
  } else if (message.type === 'message_end') {
    const text = visibleText(message.message); if (text) turn.finalText = text;
  } else if (message.type === 'agent_end') {
    const final = Array.isArray(message.messages) ? message.messages.map(visibleText).filter(Boolean).at(-1) : '';
    if (final) turn.finalText = final;
    turn.aborted = message.messages?.some((item) => item?.stopReason === 'aborted') === true;
    turn.failed = message.messages?.some((item) => item?.stopReason === 'error') === true;
  } else if (message.type === 'agent_settled') {
    const text = turn.finalText || turn.text;
    if (text) emit('message.completed', { text }, turn.id, { requestId: turn.requestId, itemId: null });
    if (turn.failed) emit('turn.failed', { message: 'Pi turn failed' }, turn.id, { requestId: turn.requestId, itemId: null });
    else emit('turn.completed', { status: turn.aborted ? 'interrupted' : 'completed' }, turn.id, { requestId: turn.requestId, itemId: null });
    session.turn = null; render(); void updateRecovery();
  }
}
async function startPi(cwd, runtimeDataPath, sessionFile) {
  const args = ['--mode', 'rpc', '--session-dir', runtimeDataPath, '--name', 'aibo-pi-plugin', '--no-tools', '--no-extensions', '--no-prompt-templates', '--no-context-files', '--no-approve'];
  if (sessionFile) args.push('--session', sessionFile);
  child = spawn('pi', args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  child.on('exit', () => { for (const request of pending.values()) request.reject(new Error('Pi exited')); pending.clear(); });
  lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  lines.on('line', (line) => { try { onPi(JSON.parse(line)); } catch (error) { process.stderr.write(`Invalid Pi frame: ${error}\n`); } });
  return rpc('get_state');
}
async function stopPi() {
  if (!child) return;
  lines?.close(); child.kill(); child = null;
  for (const request of pending.values()) request.reject(new Error('Pi stopped')); pending.clear();
}
async function handle({ id, method, params: p }) {
  if (method === 'aibo.initialize') {
    if (initialized) fail('invalid_request');
    if (p.expectedPlugin?.pluginId !== pluginId || p.expectedPlugin?.pluginVersion !== pluginVersion) fail('manifest_mismatch');
    const grant = p.permissionGrants?.find((item) => item.id === 'workspace.read' && item.decision === 'granted' && item.enforcement === 'agent-native');
    workspaceRoots = Array.isArray(grant?.constraints?.roots) ? grant.constraints.roots : [];
    initialized = true;
    respond(id, { kind: 'initialized', pluginId, pluginVersion, runtimeProtocolVersion: '1.0', viewProtocolVersion: '1.0', agents: [{ agentId, agentVersion: null, capabilities }] }); return;
  }
  if (!initialized) fail('not_initialized');
  if (method === 'aibo.diagnose') {
    const checked = spawnSync('pi', ['--version'], { encoding: 'utf8', timeout: 5000 }); const ready = checked.status === 0;
    respond(id, { kind: 'diagnostic', status: ready ? 'ready' : 'missing', dependencies: [{ name: 'pi', status: ready ? 'ready' : 'missing', version: ready ? checked.stdout.trim() : null }], message: ready ? null : 'Pi CLI is unavailable' }); return;
  }
  if (method === 'aibo.shutdown') { await stopPi(); respond(id, { kind: 'shutdown' }); process.stdin.destroy(); return; }
  if (p.agentId !== agentId) fail('invalid_request');
  if (method === 'session.create' || method === 'session.resume') {
    if (session || !p.workspace?.path || !workspaceRoots.includes(p.workspace.path) || typeof p.executionProfile?.runtimeDataPath !== 'string') fail('permission_denied');
    const previous = method === 'session.resume' ? p.binding?.recovery : null;
    if (previous && (previous.schema !== 'dev.aibo.pi.recovery' || previous.version !== 1)) fail('invalid_recovery_data');
    const state = await startPi(p.workspace.path, p.executionProfile.runtimeDataPath, previous?.data?.sessionFile ?? null);
    const nativeId = state.data?.sessionId;
    if (!nativeId) fail('invalid_session', 'Pi did not return a session id');
    const model = previous?.data?.model;
    session = { id: p.sessionId, nativeId, sessionFile: state.data?.sessionFile ?? null,
      model: model && typeof model.provider === 'string' && typeof model.modelId === 'string' ? model : null,
      thinkingLevel: typeof previous?.data?.thinkingLevel === 'string' ? previous.data.thinkingLevel : null,
      revision: 0, turn: null };
    if (session.model) await rpc('set_model', session.model);
    if (session.thinkingLevel) await rpc('set_thinking_level', { level: session.thinkingLevel });
    respond(id, { kind: 'session', agentId, sessionId: session.id, nativeSessionId: nativeId, recovery: recovery() });
    emit('session.started', { state: 'idle' }); render(); return;
  }
  if (!session || p.sessionId !== session.id) fail('invalid_session');
  if (method === 'turn.send') {
    if (session.turn) fail('busy');
    session.turn = { id: p.turnId, requestId: id, text: '', finalText: '', aborted: false, failed: false };
    await rpc('prompt', { message: p.input.text }); respond(id, { kind: 'accepted', accepted: true }); return;
  }
  if (method === 'turn.cancel') { if (session.turn?.id === p.turnId) await rpc('abort'); respond(id, { kind: 'accepted', accepted: true }); return; }
  if (method === 'operation.invoke') {
    let result;
    if (p.operationId === 'ext.dev.aibo.pi.model') {
      if (p.input?.action === 'list') result = await rpc('get_available_models');
      else if (p.input?.action === 'set' && p.input.provider && p.input.modelId) {
        session.model = { provider: p.input.provider, modelId: p.input.modelId };
        result = await rpc('set_model', session.model); await updateRecovery();
      }
      else fail('invalid_request', 'provider and modelId are required when selecting a model');
    } else if (p.operationId === 'ext.dev.aibo.pi.reasoning') {
      if (p.input?.action === 'list') result = await rpc('get_available_thinking_levels');
      else if (p.input?.action === 'set' && p.input.level) {
        session.thinkingLevel = p.input.level;
        result = await rpc('set_thinking_level', { level: p.input.level }); await updateRecovery();
      }
      else fail('invalid_request', 'level is required when selecting reasoning effort');
    } else if (p.operationId === 'ext.dev.aibo.pi.commands') result = await rpc('get_commands');
    else if (p.operationId === 'ext.dev.aibo.pi.queue') {
      if (p.input?.action === 'clear') result = await rpc('clear_queue');
      else if (p.input?.action === 'steer' && p.input.message) result = await rpc('steer', { message: p.input.message });
      else if (p.input?.action === 'followUp' && p.input.message) result = await rpc('follow_up', { message: p.input.message });
      else fail('invalid_request', 'message is required when adding to the queue');
    } else if (p.operationId === 'ext.dev.aibo.pi.compact') result = await rpc('compact', { customInstructions: p.input?.instructions || undefined });
    else if (p.operationId === 'ext.dev.aibo.pi.tree') {
      if (p.input?.action === 'get') result = await rpc('get_tree');
      else if (p.input?.action === 'navigate' && p.input.entryId) result = await rpc('navigate_tree', {
        entryId: p.input.entryId, summarize: p.input.summarize === true,
        customInstructions: p.input.customInstructions ?? null, replaceInstructions: false,
      });
      else fail('invalid_request', 'tree action and entryId are required');
    }
    else fail('capability_unsupported');
    respond(id, { kind: 'operation', operationId: p.operationId, output: result?.data ?? {} }); return;
  }
  if (method === 'session.close') { await stopPi(); session = null; respond(id, { kind: 'accepted', accepted: true }); return; }
  fail('capability_unsupported');
}
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', (line) => { let request; try { request = JSON.parse(line); Promise.resolve(handle(request)).catch((error) => write({ id: request.id, error: { code: -32000, message: error.message, data: { kind: error.kind ?? 'internal', retryable: false } } })); } catch {} });
input.on('close', () => void stopPi());
