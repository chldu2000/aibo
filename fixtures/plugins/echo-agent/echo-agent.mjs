// Standalone protocol fixture: no Aibo imports, database, workspace or network access.
const pluginId = 'dev.aibo.echo';
const agentId = `${pluginId}.agent`;
const capabilities = ['session.create', 'session.resume', 'session.close', 'turn.send', 'turn.cancel', 'stream.text', 'view.standard', 'command.list', 'model.select', 'model.reasoning', 'ext.dev.aibo.echo.refresh'];
const sessions = new Map();
const pendingCoreTools = new Map();
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
    title: 'Echo tasks', data: { cursor: `Completed turns: ${session.cursor}` },
    bindings: [{ nodeId: 'cursor', property: 'text', dataPath: '/cursor' }],
    actions: [{ id: 'commands', capability: 'command.list', inputSchema: { type: 'object', additionalProperties: false }, confirmation: 'never' },
      { id: 'refresh', capability: 'ext.dev.aibo.echo.refresh', operationId: 'ext.dev.aibo.echo.refresh',
      inputSchema: { type: 'object', additionalProperties: false, required: ['label'], properties: { label: { type: 'string', minLength: 1, maxLength: 80 } } }, confirmation: 'never' }], resources: [],
    root: { id: 'tasks', type: 'panel', props: { title: 'Echo tasks' }, children: [
      { id: 'status', type: 'badge', props: { text: session.turn ? 'Running' : 'Ready', tone: 'info' }, children: [] },
      { id: 'cursor', type: 'text', props: { text: `Completed turns: ${session.cursor}` }, children: [] },
      { id: 'label', type: 'form-field', props: { fieldId: 'label', label: 'Refresh label', value: 'manual' }, children: [] },
      { id: 'refresh', type: 'button', props: { actionId: 'refresh', label: 'Refresh view' }, children: [] },
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
  for (const pending of pendingCoreTools.values()) pending.reject(new Error('fixture stopped'));
  pendingCoreTools.clear();
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
    session.model = p.executionProfile?.model ?? 'echo/model';
    session.reasoningEffort = p.executionProfile?.reasoningEffort ?? 'low';
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
    if (!Array.isArray(p.input.attachments) || p.input.attachments.some((attachment) => typeof attachment?.attachmentId !== 'string' || !attachment.attachmentId)) fail('invalid_request');
    const turn = { id: p.turnId, requestId: id, timer: null };
    session.turn = turn;
    respond({ kind: 'accepted', accepted: true }); event(session, 'turn.started', {}, turn); view(session);
    if (p.input.text === 'reasoning fixture') {
      event(session, 'reasoning.updated', { itemId: 'reasoning-fixture', delta: 'Checking the fixture.' }, turn);
      event(session, 'reasoning.completed', { itemId: 'reasoning-fixture', summary: 'Checking the fixture.' }, turn);
    }
    if (p.input.text === 'core tool fixture') {
      const toolRequestId = `echo-tool-${id}`;
      const toolResult = new Promise((resolve, reject) => pendingCoreTools.set(toolRequestId, { resolve, reject }));
      write({ id: toolRequestId, method: 'aibo/tool-request', params: {
        agentId, sessionId: session.id, nativeSessionId: session.nativeId, turnId: turn.id,
        tool: 'write_file', input: { path: 'core-tool.txt', content: 'Core mediated Pi write' },
      } });
      toolResult.then(() => {
        if (session.turn !== turn) return;
        event(session, 'message.completed', { text: 'Core mediated Pi write', itemId: 'core-tool-result' }, turn);
        finish(session, 'completed');
      }).catch(() => {
        if (session.turn !== turn) return;
        finish(session, 'failed');
      });
      return;
    }
    if (p.input.text === 'core command fixture') {
      const toolRequestId = `echo-command-${id}`;
      const toolResult = new Promise((resolve, reject) => pendingCoreTools.set(toolRequestId, { resolve, reject }));
      write({ id: toolRequestId, method: 'aibo/tool-request', params: {
        agentId, sessionId: session.id, nativeSessionId: session.nativeId, turnId: turn.id,
        tool: 'run_command', input: { command: 'printf AIBO_CORE_COMMAND_OK', cwd: '.', timeout: 5 },
      } });
      toolResult.then((result) => {
        if (session.turn !== turn) return;
        event(session, 'message.completed', { text: result.output ?? '', itemId: 'core-command-result' }, turn);
        finish(session, 'completed');
      }).catch(() => {
        if (session.turn !== turn) return;
        finish(session, 'failed');
      });
      return;
    }
    if (p.input.text === 'core read fixture') {
      const toolRequestId = `echo-read-${id}`;
      const toolResult = new Promise((resolve, reject) => pendingCoreTools.set(toolRequestId, { resolve, reject }));
      write({ id: toolRequestId, method: 'aibo/tool-request', params: {
        agentId, sessionId: session.id, nativeSessionId: session.nativeId, turnId: turn.id,
        tool: 'read_file', input: { path: 'read-tool.txt', action: 'read' },
      } });
      toolResult.then((result) => {
        if (session.turn !== turn) return;
        event(session, 'message.completed', { text: result.content ?? '', itemId: 'core-read-result' }, turn);
        finish(session, 'completed');
      }).catch(() => {
        if (session.turn !== turn) return;
        finish(session, 'failed');
      });
      return;
    }
    if (p.input.text === 'core image fixture') {
      const toolRequestId = `echo-image-${id}`;
      const toolResult = new Promise((resolve, reject) => pendingCoreTools.set(toolRequestId, { resolve, reject }));
      write({ id: toolRequestId, method: 'aibo/tool-request', params: {
        agentId, sessionId: session.id, nativeSessionId: session.nativeId, turnId: turn.id,
        tool: 'read_file', input: { path: 'read-tool.png', action: 'read' },
      } });
      toolResult.then((result) => {
        if (session.turn !== turn) return;
        event(session, 'message.completed', { text: JSON.stringify(result), itemId: 'core-image-result' }, turn);
        finish(session, 'completed');
      }).catch(() => {
        if (session.turn !== turn) return;
        finish(session, 'failed');
      });
      return;
    }
    if (p.input.text === 'core read boundary') {
      const toolRequestId = `echo-boundary-${id}`;
      const toolResult = new Promise((resolve, reject) => pendingCoreTools.set(toolRequestId, { resolve, reject }));
      write({ id: toolRequestId, method: 'aibo/tool-request', params: {
        agentId, sessionId: session.id, nativeSessionId: session.nativeId, turnId: turn.id,
        tool: 'read_file', input: { path: '../outside-read.txt', action: 'read' },
      } });
      toolResult.then(() => {
        if (session.turn !== turn) return;
        finish(session, 'failed');
      }).catch(() => {
        if (session.turn !== turn) return;
        finish(session, 'completed');
      });
      return;
    }
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
  if (method === 'operation.invoke') {
    if (p.operationId === 'ext.dev.aibo.echo.model') {
      if (p.input?.action === 'set') {
        const reference = p.input.reference ?? (p.input.provider && p.input.modelId ? `${p.input.provider}/${p.input.modelId}` : null);
        if (!reference) fail('invalid_request');
        session.model = reference;
      }
      respond({ kind: 'operation', operationId: p.operationId, output: { current: session.model, models: [{ id: session.model, reference: session.model, reasoningEfforts: ['low', 'high'] }] } }); return;
    }
    if (p.operationId === 'ext.dev.aibo.echo.reasoning') {
      if (p.input?.action === 'set') {
        if (!['low', 'high'].includes(p.input.level)) fail('invalid_request');
        session.reasoningEffort = p.input.level;
      }
      respond({ kind: 'operation', operationId: p.operationId, output: { current: session.reasoningEffort, levels: ['low', 'high'] } }); return;
    }
    if (p.operationId === 'ext.dev.aibo.echo.commands') {
      respond({ kind: 'operation', operationId: p.operationId, output: { commands: [] } }); return;
    }
    if (p.operationId !== 'ext.dev.aibo.echo.refresh' || typeof p.input?.label !== 'string' || !p.input.label) fail('invalid_request');
    respond({ kind: 'operation', operationId: p.operationId, output: { cursor: session.cursor } }); view(session); return;
  }
  fail('capability_unsupported');
}
function onLine(line) {
  let request;
  try {
    request = JSON.parse(line);
    if (!request || request.jsonrpc !== '2.0' || !['string', 'number'].includes(typeof request.id)) fail('invalid_request');
    if (request.method === undefined && (request.result !== undefined || request.error !== undefined)) {
      const pending = pendingCoreTools.get(String(request.id));
      if (!pending) fail('invalid_request');
      pendingCoreTools.delete(String(request.id));
      request.error ? pending.reject(new Error('Core tool request rejected')) : pending.resolve(request.result);
      return;
    }
    if (!request.params || typeof request.params !== 'object') fail('invalid_request');
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
