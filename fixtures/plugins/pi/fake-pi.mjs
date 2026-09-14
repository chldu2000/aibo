#!/usr/bin/env node
import { appendFileSync, readFileSync, watch } from 'node:fs';
import readline from 'node:readline';
const write = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const controlPath = process.env.AIBO_FAKE_PI_CONTROL_FILE;
const control = () => controlPath ? readFileSync(controlPath, 'utf8') : '';
const log = (event) => { if (controlPath) appendFileSync(controlPath, `${event}\n`); };
const startIndex = controlPath ? control().split('\n').filter((line) => line.startsWith('start:')).length + 1 : 0;
let delayedExit = false;
let deferredState = null;
let exitReleased = false;
const checkControl = () => {
  const current = control();
  if (delayedExit && !exitReleased && current.includes('release-old')) {
    exitReleased = true;
    log(`exit:${startIndex}`);
    process.exit(0);
  }
  if (deferredState && current.includes('release-new')) {
    const request = deferredState;
    deferredState = null;
    write({ id: request.id, type: 'response', command: request.type, success: true, data: { sessionId: 'native-pi-session', sessionFile: '/tmp/fake-pi-session.jsonl' } });
  }
};
if (controlPath) {
  log(`start:${startIndex}:${process.pid}`);
  watch(controlPath, checkControl);
}
process.on('SIGTERM', () => { delayedExit = Boolean(controlPath); log(`sigterm:${startIndex}`); checkControl(); if (!controlPath) process.exit(0); });
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', (line) => {
  const request = JSON.parse(line);
  if (request.type === 'get_state') {
    log(`get_state:${startIndex}`);
    if (controlPath && startIndex > 1 && !control().includes('release-new')) deferredState = request;
    else write({ id: request.id, type: 'response', command: request.type, success: true, data: { sessionId: 'native-pi-session', sessionFile: '/tmp/fake-pi-session.jsonl' } });
  }
  else if (request.type === 'prompt') {
    if (request.message === 'fail prompt') write({ id: request.id, type: 'response', command: request.type, success: false, error: 'fake prompt rejection' });
    else if (request.message === 'provider failure') {
      write({ id: request.id, type: 'response', command: request.type, success: true });
      write({ type: 'agent_end', messages: [{ role: 'assistant', content: [], stopReason: 'error', errorMessage: 'provider rejected model' }], willRetry: false });
      write({ type: 'agent_settled' });
    } else {
      write({ id: request.id, type: 'response', command: request.type, success: true });
      const messages = request.message === 'two messages'
        ? [{ id: 'assistant-message-1', role: 'assistant', content: [{ type: 'text', text: 'first message' }], stopReason: 'stop' },
          { id: 'assistant-message-2', role: 'assistant', content: [{ type: 'text', text: 'second message' }], stopReason: 'stop' }]
        : [{ role: 'assistant', content: [{ type: 'text', text: request.message }], stopReason: 'stop' }];
      for (const message of messages) {
        write({ type: 'message_start', message });
        write({ type: 'message_update', message, assistantMessageEvent: { type: 'text_delta', delta: message.content[0].text } });
        write({ type: 'message_end', message });
      }
      write({ type: 'agent_end', messages, willRetry: false });
      write({ type: 'agent_settled' });
    }
  } else if (request.type === 'abort') write({ id: request.id, type: 'response', command: request.type, success: true });
  else if (request.type === 'get_available_models') write({ id: request.id, type: 'response', command: request.type, success: true, data: { models: [{ provider: 'fake', id: 'model-1', name: 'Fake Model' }] } });
  else if (request.type === 'set_model') write({ id: request.id, type: 'response', command: request.type, success: true, data: { provider: request.provider, id: request.modelId } });
  else if (request.type === 'get_available_thinking_levels') write({ id: request.id, type: 'response', command: request.type, success: true, data: { levels: ['off', 'high'] } });
  else if (request.type === 'set_thinking_level') write({ id: request.id, type: 'response', command: request.type, success: true, data: { level: request.level } });
  else if (request.type === 'get_commands') write({ id: request.id, type: 'response', command: request.type, success: true, data: { commands: [{ name: 'review', source: 'skill' }] } });
  else if (request.type === 'steer' || request.type === 'follow_up') write({ id: request.id, type: 'response', command: request.type, success: true, data: { queued: request.message } });
  else if (request.type === 'clear_queue') write({ id: request.id, type: 'response', command: request.type, success: true, data: { steering: [], followUp: [] } });
  else if (request.type === 'compact') write({ id: request.id, type: 'response', command: request.type, success: true, data: { summary: request.customInstructions ?? 'compact' } });
  else if (request.type === 'get_tree') write({ id: request.id, type: 'response', command: request.type, success: true, data: { tree: [], leafId: null, branch: [] } });
  else if (request.type === 'navigate_tree') write({ id: request.id, type: 'response', command: request.type, success: true, data: { cancelled: false, editorText: null, tree: [], leafId: request.entryId } });
});
