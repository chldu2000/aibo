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
});
