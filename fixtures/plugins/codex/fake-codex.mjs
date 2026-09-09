#!/usr/bin/env node
import readline from 'node:readline';
const write = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let goal = null;
input.on('line', (line) => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  const { id, method, params = {} } = request;
  if (method === 'initialize') write({ id, result: { userAgent: 'fake-codex/1.0.0' } });
  else if (method === 'thread/start') write({ id, result: { thread: { id: 'native-thread' }, approvalPolicy: 'never', sandbox: { type: 'readOnly' } } });
  else if (method === 'thread/resume') write({ id, result: { thread: { id: params.threadId } } });
  else if (method === 'turn/start') {
    if (params.input?.[0]?.text === 'selected config' && (params.model !== 'gpt-fake' || params.reasoningEffort !== 'high')) {
      write({ id, error: { code: -32000, message: 'selected model or reasoning effort missing' } });
      return;
    }
    write({ id, result: { turn: { id: 'native-turn' } } });
    write({ method: 'turn/started', params: { threadId: params.threadId, turn: { id: 'native-turn', status: 'inProgress' } } });
    write({ method: 'item/agentMessage/delta', params: { threadId: params.threadId, turnId: 'native-turn', itemId: 'message', delta: params.input[0].text } });
    write({ method: 'item/completed', params: { threadId: params.threadId, turnId: 'native-turn', item: { id: 'message', type: 'agentMessage', text: params.input[0].text } } });
    write({ method: 'turn/completed', params: { threadId: params.threadId, turn: { id: 'native-turn', status: 'completed', items: [] } } });
  } else if (method === 'turn/interrupt') write({ id, result: {} });
  else if (method === 'thread/goal/get') write({ id, result: { goal } });
  else if (method === 'thread/goal/set') {
    goal = { objective: params.objective, tokenBudget: params.tokenBudget, status: 'active' };
    write({ id, result: { goal } });
  } else if (method === 'thread/goal/clear') {
    goal = null;
    write({ id, result: { goal } });
  } else if (method === 'model/list') write({ id, result: { data: [{ id: 'gpt-fake', model: 'gpt-fake', displayName: 'GPT Fake', isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }] }] } });
  else if (method === 'skills/list') write({ id, result: { data: [{ cwd: params.cwds[0], skills: [{ name: 'review', interface: { shortDescription: 'Review code' } }] }] } });
});
