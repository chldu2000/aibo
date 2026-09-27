#!/usr/bin/env node
// Minimal ACP v1 agent for host tests. Behaviour switches:
//   ECHO_LOAD=0          no session/load support
//   ECHO_IMAGE=1         advertises image prompts
//   ECHO_MODE_API=config modes as a config option (default: the session modes API)
// Prompts containing "permission" request approval with all four ACP option kinds, "vendor"
// calls an unregistered client method, "mcp" reports the MCP servers it was given, and "wait"
// blocks until session/cancel. "exitplan" asks to leave plan mode like Claude Code's ExitPlanMode and
// switches to code when approved; "rogue" switches to code without asking. With client elicitation,
// "question" sends an AskUserQuestion-style form plus a typed field, and "nestedform" a form with a
// nested object field.
import { createInterface } from 'node:readline';

const load = process.env.ECHO_LOAD !== '0', image = process.env.ECHO_IMAGE === '1', configModes = process.env.ECHO_MODE_API === 'config';
const sessions = new Map();
let nextId = 1, cancelled = null, elicitation = false;
const pending = new Map();
const send = message => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
const request = (method, params) => new Promise(resolve => { const id = `agent-${nextId++}`; pending.set(id, resolve); send({ id, method, params }); });
const update = (sessionId, value) => send({ method: 'session/update', params: { sessionId, update: value } });
const models = current => ({ id: 'model', category: 'model', type: 'select', currentValue: current, options: [{ value: 'echo-small', name: 'Echo Small' }, { value: 'echo-large', name: 'Echo Large' }] });
function state(session) {
  const configOptions = [models(session.model)];
  if (configModes) return { configOptions: [...configOptions, { id: 'mode', category: 'mode', type: 'select', currentValue: session.mode, options: [{ value: 'ask' }, { value: 'plan' }, { value: 'code' }] }] };
  return { configOptions, modes: { currentModeId: session.mode, availableModes: [{ id: 'ask', name: 'Ask' }, { id: 'plan', name: 'Plan' }, { id: 'code', name: 'Code' }] } };
}

async function prompt(id, { sessionId, prompt: blocks }) {
  const text = blocks.filter(block => block.type === 'text').map(block => block.text).join('\n');
  const reply = [`echo: ${text}`];
  for (const block of blocks.filter(block => block.type === 'image')) reply.push(`image:${block.mimeType}:${Buffer.from(block.data, 'base64').length}`);
  if (text.includes('permission')) {
    const options = [['yes', 'allow_once'], ['always', 'allow_always'], ['no', 'reject_once'], ['never', 'reject_always']].map(([optionId, kind]) => ({ optionId, kind, name: optionId }));
    update(sessionId, { sessionUpdate: 'tool_call', toolCallId: 'write-1', title: 'Write notes.md', kind: 'edit', status: 'pending' });
    const answer = await request('session/request_permission', { sessionId, options, toolCall: { toolCallId: 'write-1', kind: 'edit', title: 'Write notes.md' } });
    reply.push(`permission:${answer?.outcome?.optionId ?? answer?.outcome?.outcome}`);
    update(sessionId, { sessionUpdate: 'tool_call_update', toolCallId: 'write-1', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: 'written' } }] });
  }
  if (text.includes('exitplan')) {
    const options = [['exit-plan-clear-default', 'allow_always'], ['exit-plan-auto', 'allow_always'], ['exit-plan-default', 'allow_once'], ['reject', 'reject_once']].map(([optionId, kind]) => ({ optionId, kind, name: optionId }));
    update(sessionId, { sessionUpdate: 'tool_call', toolCallId: 'plan-1', title: 'Approve Plan', kind: 'switch_mode', status: 'pending' });
    const answer = await request('session/request_permission', { sessionId, options, toolCall: { toolCallId: 'plan-1', kind: 'switch_mode', title: 'Approve Plan' } });
    const chosen = answer?.outcome?.optionId ?? answer?.outcome?.outcome;
    if (chosen === 'exit-plan-default' || chosen === 'exit-plan-clear-default') { sessions.get(sessionId).mode = 'code'; update(sessionId, { sessionUpdate: 'current_mode_update', currentModeId: 'code' }); }
    reply.push(`exitplan:${chosen}`);
  }
  if (text.includes('rogue')) { sessions.get(sessionId).mode = 'code'; update(sessionId, { sessionUpdate: 'current_mode_update', currentModeId: 'code' }); }
  if (elicitation && text.includes('question')) {
    const answer = await request('elicitation/create', { sessionId, mode: 'form', toolCallId: 'ask-1', message: 'Pick a colour and a count.', requestedSchema: { type: 'object', required: ['count'], properties: {
      question_0: { type: 'string', title: 'Colour', description: 'Which colour?', oneOf: [{ const: 'red', title: 'Red', description: 'Warm' }, { const: 'blue', title: 'Blue' }] },
      question_0_custom: { type: 'string', title: 'Other', _meta: { _askUserQuestionCustomAnswer: { questionId: 'question_0', isCustomAnswer: true } } },
      count: { type: 'integer', title: 'Count', description: 'How many?', minimum: 1, maximum: 5 },
    } } });
    if (answer?.action === 'cancel') return send({ id, result: { stopReason: 'cancelled' } });
    reply.push(`question:${JSON.stringify(answer)}`);
  }
  if (elicitation && text.includes('nestedform')) {
    const answer = await request('elicitation/create', { sessionId, mode: 'form', message: 'Nested', requestedSchema: { type: 'object', properties: { address: { type: 'object', properties: {} } } } });
    reply.push(`nested:${answer?.action}`);
  }
  if (text.includes('vendor')) {
    const answer = await request('echo/ask', { sessionId });
    reply.push(`vendor:${answer?.error?.code ?? 'answered'}`);
  }
  if (text.includes('mcp')) reply.push(`mcp:${sessions.get(sessionId).mcpServers.length}`);
  if (text.includes('wait')) {
    await new Promise(resolve => { cancelled = resolve; });
    return send({ id, result: { stopReason: 'cancelled' } });
  }
  update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: reply.join(' ') } });
  send({ id, result: { stopReason: 'end_turn' } });
}

createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line);
  if (message.id !== undefined && message.method === undefined) {
    const resolve = pending.get(message.id); pending.delete(message.id);
    return resolve?.(message.result ?? { error: message.error });
  }
  const { id, method, params } = message;
  const session = sessions.get(params?.sessionId);
  switch (method) {
    case 'initialize': elicitation = params.clientCapabilities?.elicitation?.form !== undefined; return send({ id, result: { protocolVersion: 1, agentCapabilities: { loadSession: load, promptCapabilities: { image } }, authMethods: [] } });
    case 'session/new': {
      const sessionId = `echo-${sessions.size + 1}`, created = { mode: 'ask', model: 'echo-small', mcpServers: params.mcpServers ?? [] };
      sessions.set(sessionId, created);
      send({ id, result: { sessionId, ...state(created) } });
      return update(sessionId, { sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'echo-help', description: 'Explain the echo agent' }] });
    }
    case 'session/load': {
      if (!load) return send({ id, error: { code: -32601, message: 'Method not found' } });
      const restored = { mode: 'ask', model: 'echo-small' };
      sessions.set(params.sessionId, restored);
      send({ id, result: state(restored) });
      return update(params.sessionId, { sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'echo-help', description: 'Explain the echo agent' }] });
    }
    case 'session/set_mode': session.mode = params.modeId; return send({ id, result: {} });
    case 'session/set_config_option':
      if (params.configId === 'mode') session.mode = params.value; else session.model = params.value;
      return send({ id, result: state(session) });
    case 'session/prompt': return void prompt(id, params);
    case 'session/cancel': cancelled?.(); cancelled = null; return;
    default: if (id !== undefined) send({ id, error: { code: -32601, message: 'Method not found' } });
  }
});
