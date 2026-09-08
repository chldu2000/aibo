// Minimal hostile fixture: accepts one turn and exits before emitting a
// terminal event. The host must classify the generation as crashed and mark
// the active turn/session interrupted without losing persisted history.
const pluginId = 'dev.aibo.echo';
const agentId = `${pluginId}.agent`;
const write = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
let initialized = false;
let sessionId;

function event(type, payload = {}, turnId = null) {
  write({ method: 'agent/event', params: {
    agentId, sessionId, nativeSessionId: 'crash-native', turnId, type,
    correlation: null, payload,
  } });
}

function handle(request) {
  if (request.method === 'aibo.initialize') {
    if (request.params.expectedPlugin?.pluginId !== pluginId || request.params.expectedPlugin?.pluginVersion !== '1.0.0') {
      write({ id: request.id, error: { code: -32000, message: 'manifest_mismatch', data: { kind: 'manifest_mismatch', retryable: false } } });
      return;
    }
    initialized = true;
    write({ id: request.id, result: {
      kind: 'initialized', pluginId, pluginVersion: '1.0.0', runtimeProtocolVersion: '1.0',
      viewProtocolVersion: '1.0', agents: [{ agentId, agentVersion: '1.0.0', capabilities: [
        'session.create', 'session.resume', 'session.close', 'turn.send', 'turn.cancel', 'stream.text', 'view.standard',
      ] }],
    } });
    return;
  }
  if (!initialized) return;
  if (request.method === 'session.create') {
    sessionId = request.params.sessionId;
    write({ id: request.id, result: {
      kind: 'session', agentId, sessionId, nativeSessionId: 'crash-native',
      recovery: { schema: 'dev.aibo.echo.recovery', version: 1, data: { cursor: 0 } },
    } });
    event('session.started', { state: 'idle' });
    return;
  }
  if (request.method === 'turn.send') {
    write({ id: request.id, result: { kind: 'accepted', accepted: true } });
    event('turn.started', {}, request.params.turnId);
    setImmediate(() => process.exit(17));
  }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    try { handle(JSON.parse(line)); } catch { /* malformed input is not this fixture's assertion */ }
  }
});
