import { spawn, spawnSync } from 'node:child_process';
import readline from 'node:readline';

const pluginId = 'dev.aibo.codex';
const pluginVersion = '1.0.0';
const agentId = 'dev.aibo.codex.agent';
const capabilities = ['session.create', 'session.resume', 'session.close', 'turn.send', 'turn.cancel', 'stream.text', 'view.standard', 'goal.manage', 'model.select', 'model.reasoning', 'skill.list'];
let initialized = false;
let workspaceReadGranted = false;
let workspaceRoots = [];
let child = null;
let childLines = null;
let nextId = 1;
let session = null;
const pending = new Map();

const write = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
const respond = (id, result) => write({ id, result });
const fail = (kind, message = kind) => { throw Object.assign(new Error(message), { kind }); };
const emit = (type, payload, turnId = null, correlation = null) => write({ method: 'agent/event', params: {
  agentId, sessionId: session.id, nativeSessionId: session.threadId, turnId, type, correlation, payload,
} });
function render() {
  write({ method: 'view/render', params: { agentId, sessionId: session.id, document: {
    schema: 'aibo.plugin-view/v1', viewId: 'dev.aibo.codex.status', revision: ++session.revision,
    title: 'Codex status', data: {}, bindings: [], actions: [], resources: [], root: {
      id: 'status', type: 'panel', props: { title: 'Codex' }, children: [
        { id: 'state', type: 'badge', props: { text: session.turn ? 'Running' : 'Ready', tone: 'info' }, children: [] },
        { id: 'thread', type: 'text', props: { text: `Thread: ${session.threadId}` }, children: [] },
      ],
    },
  } } });
}
function rpc(method, params) {
  const id = `codex-${nextId++}`;
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
function notify(method, params) { child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`); }
function onCodex(message) {
  if (message.id !== undefined && pending.has(String(message.id))) {
    const request = pending.get(String(message.id)); pending.delete(String(message.id));
    message.error ? request.reject(new Error(message.error.message ?? 'Codex request failed')) : request.resolve(message.result);
    return;
  }
  if (message.id !== undefined && message.method?.endsWith('/requestApproval')) {
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { decision: 'decline' } })}\n`); return;
  }
  if (!session || !message.method) return;
  const p = message.params ?? {};
  const turn = session.turn;
  if (message.method === 'turn/started' && turn) {
    turn.nativeId = p.turn?.id ?? null;
    emit('turn.started', {}, turn.id, { requestId: turn.requestId, itemId: null }); render();
  } else if (message.method === 'item/agentMessage/delta' && turn) {
    const delta = typeof p.delta === 'string' ? p.delta : '';
    if (delta) { turn.text += delta; emit('message.delta', { delta }, turn.id, { requestId: turn.requestId, itemId: p.itemId ?? null }); }
  } else if (message.method === 'item/completed' && turn && p.item?.type === 'agentMessage') {
    if (typeof p.item.text === 'string') turn.finalText = p.item.text;
  } else if (message.method === 'turn/completed' && turn) {
    const nativeStatus = p.turn?.status;
    const status = nativeStatus === 'completed' ? 'completed' : nativeStatus === 'interrupted' ? 'interrupted' : 'failed';
    const text = turn.finalText || p.turn?.items?.filter((item) => item?.type === 'agentMessage').at(-1)?.text || turn.text;
    if (text) emit('message.completed', { text }, turn.id, { requestId: turn.requestId, itemId: null });
    emit(status === 'failed' ? 'turn.failed' : 'turn.completed', status === 'failed' ? { message: 'Codex turn failed' } : { status }, turn.id, { requestId: turn.requestId, itemId: null });
    session.turn = null; render();
  }
}
async function startCodex(cwd) {
  child = spawn('codex', ['app-server', '--stdio'], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  child.on('exit', () => { for (const request of pending.values()) request.reject(new Error('Codex exited')); pending.clear(); });
  childLines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  childLines.on('line', (line) => { try { onCodex(JSON.parse(line)); } catch (error) { process.stderr.write(`Invalid Codex frame: ${error}\n`); } });
  await rpc('initialize', { clientInfo: { name: 'aibo_codex_plugin', title: 'Aibo Codex Plugin', version: pluginVersion }, capabilities: { experimentalApi: true } });
  notify('initialized', {});
}
async function stopCodex() {
  if (!child) return;
  childLines?.close(); child.kill(); child = null;
  for (const request of pending.values()) request.reject(new Error('Codex stopped')); pending.clear();
}
async function handle({ id, method, params: p }) {
  if (method === 'aibo.initialize') {
    if (initialized) fail('invalid_request');
    if (p.expectedPlugin?.pluginId !== pluginId || p.expectedPlugin?.pluginVersion !== pluginVersion) fail('manifest_mismatch');
    const workspaceGrant = p.permissionGrants?.find((grant) => grant.id === 'workspace.read' && grant.decision === 'granted' && grant.enforcement === 'agent-native');
    workspaceReadGranted = Boolean(workspaceGrant);
    workspaceRoots = Array.isArray(workspaceGrant?.constraints?.roots) ? workspaceGrant.constraints.roots : [];
    initialized = true;
    respond(id, { kind: 'initialized', pluginId, pluginVersion, runtimeProtocolVersion: '1.0', viewProtocolVersion: '1.0', agents: [{ agentId, agentVersion: null, capabilities }] }); return;
  }
  if (!initialized) fail('not_initialized');
  if (method === 'aibo.diagnose') {
    const checked = spawnSync('codex', ['--version'], { encoding: 'utf8', timeout: 5000 });
    const ready = checked.status === 0;
    respond(id, { kind: 'diagnostic', status: ready ? 'ready' : 'missing', dependencies: [{ name: 'codex', status: ready ? 'ready' : 'missing', version: ready ? checked.stdout.trim() : null }], message: ready ? null : 'Codex CLI is unavailable' }); return;
  }
  if (method === 'aibo.shutdown') { await stopCodex(); respond(id, { kind: 'shutdown' }); process.stdin.destroy(); return; }
  if (p.agentId !== agentId) fail('invalid_request');
  if (method === 'session.create' || method === 'session.resume') {
    if (session || !workspaceReadGranted || !p.workspace?.path || !workspaceRoots.includes(p.workspace.path)) fail('permission_denied');
    await startCodex(p.workspace.path);
    let threadId;
    if (method === 'session.resume') {
      const recovery = p.binding?.recovery;
      if (p.binding?.pluginId !== pluginId || recovery?.schema !== 'dev.aibo.codex.recovery' || recovery?.version !== 1 || typeof recovery.data?.threadId !== 'string') fail('invalid_recovery_data');
      threadId = recovery.data.threadId;
      const result = await rpc('thread/resume', { threadId, approvalPolicy: 'never', sandbox: 'read-only' });
      threadId = result?.thread?.id ?? threadId;
    } else {
      const result = await rpc('thread/start', { cwd: p.workspace.path, approvalPolicy: 'never', sandbox: 'read-only', serviceName: 'aibo_codex_plugin' });
      threadId = result?.thread?.id;
    }
    if (!threadId) fail('invalid_session', 'Codex did not return a thread id');
    session = { id: p.sessionId, threadId, cwd: p.workspace.path, model: null, reasoningEffort: null, revision: 0, turn: null };
    respond(id, { kind: 'session', agentId, sessionId: session.id, nativeSessionId: threadId, recovery: { schema: 'dev.aibo.codex.recovery', version: 1, data: { threadId } } });
    emit('session.started', { state: 'idle' }); render(); return;
  }
  if (!session || p.sessionId !== session.id) fail('invalid_session');
  if (method === 'turn.send') {
    if (session.turn) fail('busy');
    const turn = { id: p.turnId, requestId: id, nativeId: null, text: '', finalText: '' };
    session.turn = turn;
    const turnParams = { threadId: session.threadId, input: [{ type: 'text', text: p.input.text }] };
    if (session.model) turnParams.model = session.model;
    if (session.reasoningEffort) turnParams.reasoningEffort = session.reasoningEffort;
    const result = await rpc('turn/start', turnParams);
    if (session.turn === turn) turn.nativeId = result?.turn?.id ?? turn.nativeId;
    respond(id, { kind: 'accepted', accepted: true }); return;
  }
  if (method === 'turn.cancel') {
    if (session.turn && session.turn.id === p.turnId && session.turn.nativeId) await rpc('turn/interrupt', { threadId: session.threadId, turnId: session.turn.nativeId });
    respond(id, { kind: 'accepted', accepted: true }); return;
  }
  if (method === 'operation.invoke' && p.operationId === 'ext.dev.aibo.codex.goal') {
    let goal;
    if (p.input?.action === 'get') goal = await rpc('thread/goal/get', { threadId: session.threadId });
    else if (p.input?.action === 'clear') goal = await rpc('thread/goal/clear', { threadId: session.threadId });
    else if (p.input?.action === 'set') {
      if (typeof p.input.objective !== 'string' || !p.input.objective.trim()) fail('invalid_request', 'objective is required when setting a goal');
      goal = await rpc('thread/goal/set', { threadId: session.threadId, objective: p.input.objective, tokenBudget: p.input.tokenBudget ?? null });
    } else fail('invalid_request', 'unknown goal action');
    const normalized = goal && Object.prototype.hasOwnProperty.call(goal, 'goal') ? goal.goal : goal ?? null;
    respond(id, { kind: 'operation', operationId: p.operationId, output: { goal: normalized } }); return;
  }
  if (method === 'operation.invoke' && p.operationId === 'ext.dev.aibo.codex.model') {
    if (p.input?.action === 'set') {
      if (typeof p.input.reference !== 'string' || !p.input.reference.trim()) fail('invalid_request', 'reference is required when selecting a model');
      session.model = p.input.reference;
    } else if (p.input?.action !== 'list') fail('invalid_request', 'unknown model action');
    const result = await rpc('model/list', { limit: 100, includeHidden: false });
    respond(id, { kind: 'operation', operationId: p.operationId, output: { current: session.model, models: result?.data ?? [] } }); return;
  }
  if (method === 'operation.invoke' && p.operationId === 'ext.dev.aibo.codex.reasoning') {
    if (p.input?.action === 'set') {
      if (typeof p.input.level !== 'string' || !p.input.level.trim()) fail('invalid_request', 'level is required when selecting reasoning effort');
      session.reasoningEffort = p.input.level;
    } else if (p.input?.action !== 'list') fail('invalid_request', 'unknown reasoning action');
    const result = await rpc('model/list', { limit: 100, includeHidden: false });
    const model = (result?.data ?? []).find((item) => item.model === session.model || item.id === session.model) ?? (result?.data ?? []).find((item) => item.isDefault) ?? null;
    respond(id, { kind: 'operation', operationId: p.operationId, output: { current: session.reasoningEffort, levels: model?.supportedReasoningEfforts ?? [] } }); return;
  }
  if (method === 'operation.invoke' && p.operationId === 'ext.dev.aibo.codex.skills') {
    const result = await rpc('skills/list', { cwds: [session.cwd], forceReload: false });
    const skills = (result?.data ?? []).flatMap((item) => item?.skills ?? []);
    respond(id, { kind: 'operation', operationId: p.operationId, output: { skills } }); return;
  }
  if (method === 'session.close') { await stopCodex(); session = null; respond(id, { kind: 'accepted', accepted: true }); return; }
  fail('capability_unsupported');
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', (line) => {
  let request;
  try { request = JSON.parse(line); Promise.resolve(handle(request)).catch((error) => write({ id: request.id, error: { code: -32000, message: error.message, data: { kind: error.kind ?? 'internal', retryable: false } } })); }
  catch { if (request?.id !== undefined) write({ id: request.id, error: { code: -32600, message: 'invalid_request', data: { kind: 'invalid_request', retryable: false } } }); }
});
input.on('close', () => void stopCodex());
