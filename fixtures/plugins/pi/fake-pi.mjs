#!/usr/bin/env node
import readline from 'node:readline';
const write = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', (line) => {
  const request = JSON.parse(line);
  if (request.type === 'get_state') write({ id: request.id, type: 'response', command: request.type, success: true, data: { sessionId: 'native-pi-session', sessionFile: '/tmp/fake-pi-session.jsonl' } });
  else if (request.type === 'prompt') {
    write({ id: request.id, type: 'response', command: request.type, success: true });
    write({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: request.message } });
    write({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: request.message }] } });
    write({ type: 'agent_end', messages: [{ role: 'assistant', content: [{ type: 'text', text: request.message }], stopReason: 'stop' }], willRetry: false });
    write({ type: 'agent_settled' });
  } else if (request.type === 'abort') write({ id: request.id, type: 'response', command: request.type, success: true });
  else if (request.type === 'get_available_models') write({ id: request.id, type: 'response', command: request.type, success: true, data: { models: [{ provider: 'fake', id: 'model-1', name: 'Fake Model' }] } });
  else if (request.type === 'set_model') write({ id: request.id, type: 'response', command: request.type, success: true, data: { provider: request.provider, id: request.modelId } });
  else if (request.type === 'get_available_thinking_levels') write({ id: request.id, type: 'response', command: request.type, success: true, data: { levels: ['off', 'high'] } });
  else if (request.type === 'set_thinking_level') write({ id: request.id, type: 'response', command: request.type, success: true, data: { level: request.level } });
  else if (request.type === 'get_commands') write({ id: request.id, type: 'response', command: request.type, success: true, data: { commands: [{ name: 'review', source: 'skill' }] } });
  else if (request.type === 'steer' || request.type === 'follow_up') write({ id: request.id, type: 'response', command: request.type, success: true, data: { queued: request.message } });
  else if (request.type === 'clear_queue') write({ id: request.id, type: 'response', command: request.type, success: true, data: { steering: [], followUp: [] } });
  else if (request.type === 'compact') write({ id: request.id, type: 'response', command: request.type, success: true, data: { summary: request.customInstructions ?? 'compact' } });
  else if (request.type === 'get_tree') write({ id: request.id, type: 'response', command: request.type, success: true, data: { tree: [], leafId: null } });
});
