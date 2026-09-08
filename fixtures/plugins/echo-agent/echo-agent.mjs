// Standalone protocol fixture: no Aibo imports, database, workspace or network access.
const pluginId = 'dev.aibo.echo';
const agentId = `${pluginId}.agent`;
const capabilities = ['session.create', 'session.resume', 'session.close', 'turn.send', 'turn.cancel', 'stream.text', 'view.standard'];
const sessions = new Map();
let initialized = false;
const write = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
const fail = (kind) => { throw Object.assign(new Error(kind), { kind }); };
const recovery = (session) => ({ schema: 'dev.aibo.echo.recovery', version: 1, data: { cursor: session.cursor } });
function event(session, type, payload, turn = null) {
  write({ method: 'agent/event', params: { agentId, sessionId: session.id, nativeSessionId: session.nativeId,
    turnId: turn?.id ?? null, type, correlation: turn ? { requestId: turn.requestId, itemId: turn.id } : null, payload } });
}
function view(session) {
  write({ method: 'view/render', params: { agentId, sessionId: session.id, document: {
    schema: 'aibo.plugin-view/v1', viewId: 'dev.aibo.echo.tasks', revision: ++session.revision,
    title: 'Echo tasks', data: {}, bindings: [], actions: [], resources: [],
    root: { id: 'tasks', type: 'panel', props: { title: 'Echo tasks' }, children: [
      { id: 'status', type: 'badge', props: { text: session.turn ? 'Running' : 'Ready', tone: 'info' }, children: [] },
      { id: 'cursor', type: 'text', props: { text: `Completed turns: ${session.cursor}` }, children: [] },
    ] },
  } } });
}
function finish(session, status) {
  const turn = session.turn;
  if (!turn) return;
  clearTimeout(turn.timer);
  session.turn = null;
  session.cursor++;
  event(session, 'turn.completed', { status }, turn);
  event(session, 'session.info_changed', { recovery: recovery(session) });
  view(session);
}
function stop() {
  for (const session of sessions.values()) clearTimeout(session.turn?.timer);
  sessions.clear();
}
function handle({ id, method, params: p }) {
  const respond = (result) => write({ id, result });
  if (method === 'aibo.initialize') {
    if (initialized) fail('invalid_request');
    if (p.expectedPlugin?.pluginId !== pluginId || p.expectedPlugin?.pluginVersion !== '1.0.0') fail('manifest_mismatch');
    if (!p.host?.runtimeProtocolVersions?.includes('1.0') || !p.host?.viewProtocolVersions?.includes('1.0')) fail('protocol_incompatible');
    initialized = true;
    respond({ kind: 'initialized', pluginId, pluginVersion: '1.0.0', runtimeProtocolVersion: '1.0', viewProtocolVersion: '1.0',
      agents: [{ agentId, agentVersion: '1.0.0', capabilities }] });
    return;
  }
  if (!initialized) fail('not_initialized');
  if (method === 'aibo.shutdown') {
    stop(); respond({ kind: 'shutdown' }); process.stdin.destroy(); return;
  }
  if (p.agentId !== agentId) fail('invalid_request');
  if (method === 'aibo.diagnose') {
    respond({ kind: 'diagnostic', status: 'ready', dependencies: [], message: null }); return;
  }
  if (method === 'session.create' || method === 'session.resume') {
    if (typeof p.sessionId !== 'string' || !p.sessionId || sessions.has(p.sessionId)) fail('invalid_session');
    let cursor = 0;
    let nativeId = `echo-${p.sessionId}`;
    if (method === 'session.resume') {
      const b = p.binding;
      if (b?.pluginId !== pluginId || b?.pluginVersion !== '1.0.0' || b?.agentId !== agentId || b?.sessionId !== p.sessionId || b?.runtimeProtocolVersion !== '1.0') fail('invalid_recovery_data');
      if (b.recovery?.schema !== 'dev.aibo.echo.recovery' || b.recovery?.version !== 1 || !Number.isSafeInteger(b.recovery?.data?.cursor) || b.recovery.data.cursor < 0 || typeof b.nativeSessionId !== 'string') fail('invalid_recovery_data');
      cursor = b.recovery.data.cursor; nativeId = b.nativeSessionId;
    }
    const session = { id: p.sessionId, nativeId, cursor, revision: 0, turn: null };
    sessions.set(session.id, session);
    respond({ kind: 'session', agentId, sessionId: session.id, nativeSessionId: nativeId, recovery: recovery(session) });
    event(session, 'session.started', { state: 'idle' }); view(session); return;
  }
  const session = sessions.get(p.sessionId);
  if (!session) fail('invalid_session');
  if (method === 'session.close') {
    finish(session, 'interrupted'); sessions.delete(session.id);
    respond({ kind: 'accepted', accepted: true }); return;
  }
  if (method === 'turn.cancel') {
    if (session.turn && session.turn.id !== p.turnId) fail('invalid_request');
    respond({ kind: 'accepted', accepted: true }); finish(session, 'interrupted'); return;
  }
  if (method === 'turn.send') {
    if (session.turn) fail('busy');
    if (typeof p.turnId !== 'string' || !p.turnId || typeof p.input?.text !== 'string') fail('invalid_request');
    if (p.input.attachments?.length) fail('capability_unsupported');
    const turn = { id: p.turnId, requestId: id, timer: null };
    session.turn = turn;
    respond({ kind: 'accepted', accepted: true }); event(session, 'turn.started', {}, turn); view(session);
    const chunks = Array.from(p.input.text);
    let offset = 0;
    const tick = () => {
      if (session.turn !== turn) return;
      if (offset < chunks.length) {
        event(session, 'message.delta', { delta: chunks.slice(offset, offset += 8).join('') }, turn);
        turn.timer = setTimeout(tick, 10);
      } else {
        event(session, 'message.completed', { text: p.input.text }, turn); finish(session, 'completed');
      }
    };
    turn.timer = setTimeout(tick, 10); return;
  }
  fail('capability_unsupported');
}
function onLine(line) {
  let request;
  try {
    request = JSON.parse(line);
    if (!request || request.jsonrpc !== '2.0' || !['string', 'number'].includes(typeof request.id) || !request.params || typeof request.params !== 'object') fail('invalid_request');
    handle(request);
  } catch (error) {
    if (request && ['string', 'number'].includes(typeof request.id)) {
      const kind = error.kind ?? 'invalid_request';
      write({ id: request.id, error: { code: -32000, message: kind, data: { kind, retryable: kind === 'busy' } } });
    }
  }
}
// JSONL frames on LF only; Unicode line/paragraph separators are message content.
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (Buffer.byteLength(line) > 1_048_576) { stop(); process.stdin.destroy(); return; }
    onLine(line);
  }
  if (Buffer.byteLength(buffer) > 1_048_576) { stop(); process.stdin.destroy(); }
});
process.stdin.on('end', stop);
