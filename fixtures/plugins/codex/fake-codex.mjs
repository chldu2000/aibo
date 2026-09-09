#!/usr/bin/env node
import readline from 'node:readline';
const write = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let goal = null;
let interactiveTurn = null;
function completeTurn(params) {
  write({ method: 'item/agentMessage/delta', params: { threadId: params.threadId, turnId: 'native-turn', itemId: 'message', delta: params.input[0].text } });
  write({ method: 'item/completed', params: { threadId: params.threadId, turnId: 'native-turn', item: { id: 'message', type: 'agentMessage', text: params.input[0].text } } });
  write({ method: 'turn/completed', params: { threadId: params.threadId, turn: { id: 'native-turn', status: 'completed', items: [] } } });
}
input.on('line', (line) => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  if (request.method === undefined && interactiveTurn && String(request.id) === interactiveTurn.requestId) {
    if (interactiveTurn.kind === 'approval' && !['accept', 'cancel'].includes(request.result?.decision)) throw new Error('invalid approval response');
    if (interactiveTurn.kind === 'user-input' && typeof request.result?.answers !== 'object') throw new Error('invalid user input response');
    completeTurn(interactiveTurn.params); interactiveTurn = null; return;
  }
  const { id, method, params = {} } = request;
  if (method === 'initialize') write({ id, result: { userAgent: 'fake-codex/1.0.0' } });
  else if (method === 'thread/start') write({ id, result: { thread: { id: process.env.CODEX_FAKE_THREAD_ID ?? 'native-thread' }, approvalPolicy: 'never', sandbox: { type: 'readOnly' } } });
  else if (method === 'thread/resume' && process.env.CODEX_FAKE_MISSING_ROLLOUT === '1') write({ id, error: { code: -32600, message: `no rollout found for thread id ${params.threadId}` } });
  else if (method === 'thread/resume') write({ id, result: { thread: { id: params.threadId } } });
  else if (method === 'turn/start') {
    if (params.input?.[0]?.text === 'selected config' && (params.model !== 'gpt-fake' || params.reasoningEffort !== 'high')) {
      write({ id, error: { code: -32000, message: 'selected model or reasoning effort missing' } });
      return;
    }
    write({ id, result: { turn: { id: 'native-turn' } } });
    write({ method: 'turn/started', params: { threadId: params.threadId, turn: { id: 'native-turn', status: 'inProgress' } } });
    if (params.input[0].text === 'approval please') {
      interactiveTurn = { kind: 'approval', requestId: 'provider-approval', params };
      write({ id: interactiveTurn.requestId, method: 'item/commandExecution/requestApproval', params: { threadId: params.threadId, turnId: 'native-turn', itemId: 'tool-1', command: 'test', cwd: '/tmp' } });
    } else if (params.input[0].text === 'input please') {
      interactiveTurn = { kind: 'user-input', requestId: 'provider-input', params };
      write({ id: interactiveTurn.requestId, method: 'item/tool/requestUserInput', params: { threadId: params.threadId, turnId: 'native-turn', itemId: 'tool-2', questions: [{ id: 'choice', header: 'Choice', question: 'Continue?', options: [] }] } });
    } else completeTurn(params);
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
