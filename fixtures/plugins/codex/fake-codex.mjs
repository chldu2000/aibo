#!/usr/bin/env node
import readline from 'node:readline';
const write = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let nativeTurnId = 'native-turn';
let goal = null;
const nativeTurns = [];
let interactiveTurn = null;
function completeTurn(params) {
  nativeTurns.push({id:nativeTurnId});
  write({ method: 'item/agentMessage/delta', params: { threadId: params.threadId, turnId: nativeTurnId, itemId: 'message', delta: params.input[0].text } });
  write({ method: 'item/completed', params: { threadId: params.threadId, turnId: nativeTurnId, item: { id: 'message', type: 'agentMessage', text: params.input[0].text } } });
  write({ method: 'turn/completed', params: { threadId: params.threadId, turn: { id: nativeTurnId, status: 'completed', items: [] } } });
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
  const policy = {approvalPolicy:params.approvalPolicy,model:params.model,sandbox:{type:process.env.CODEX_FAKE_SANDBOX ?? ({'read-only':'readOnly','workspace-write':'workspaceWrite','danger-full-access':'dangerFullAccess'}[params.sandbox])}};
  if (method === 'initialize') write({ id, result: { userAgent: 'fake-codex/1.0.0' } });
  else if (method === 'thread/start') write({ id, result: { thread: { id: process.env.CODEX_FAKE_THREAD_ID ?? 'native-thread' }, ...policy } });
  else if (method === 'thread/resume' && process.env.CODEX_FAKE_MISSING_ROLLOUT === '1') write({ id, error: { code: -32600, message: `no rollout found for thread id ${params.threadId}` } });
  else if (method === 'thread/resume') write({ id, result: { thread: { id: params.threadId }, ...policy } });
  else if (method === 'thread/list') write({id,result:{data:[{id:'catalog-thread',title:'Catalog entry',cwd:params.cwd,status:{type:'idle'}}]}});
  else if (method === 'thread/read' && params.includeTurns && process.env.CODEX_FAKE_NO_TURNS === '1') write({id,error:{code:-32600,message:'list_turns is not supported yet'}});
  else if (method === 'thread/read') write({id,result:{thread:{id:params.threadId,title:'Native thread',cwd:process.cwd(),status:{type:'idle'},updatedAt:'2026-09-12T00:00:00Z',turns:process.env.CODEX_FAKE_NO_TURNS === '1' ? undefined : nativeTurns}}});
  else if (method === 'thread/fork') {
    if (params.lastTurnId && params.lastTurnId !== nativeTurnId) throw Error('host turn ID leaked into native fork');
    write({id,result:{thread:{id:process.env.CODEX_FAKE_FORK_SAME_THREAD==='1'?params.threadId:'forked-thread',parentThreadId:params.threadId}}});
  }
  else if (method === 'turn/start') {
    nativeTurnId = params.input?.[0]?.text?.startsWith('unique turn:') ? params.input[0].text : 'native-turn';
    if (params.summary !== 'auto') {
      write({ id, error: { code: -32000, message: 'reasoning summary was not requested' } });
      return;
    }
    if (params.input?.[0]?.text === 'selected config' && (params.model !== 'gpt-fake' || params.reasoningEffort !== 'high')) {
      write({ id, error: { code: -32000, message: 'selected model or reasoning effort missing' } });
      return;
    }
    write({ id, result: { turn: { id: nativeTurnId } } });
    write({ method: 'turn/started', params: { threadId: params.threadId, turn: { id: nativeTurnId, status: 'inProgress' } } });
    if (params.input[0].text === 'tool please') {
      write({ method: 'item/agentMessage/delta', params: { threadId: params.threadId, turnId: nativeTurnId, itemId: 'commentary-1', delta: 'I will inspect first.' } });
      write({ method: 'item/completed', params: { threadId: params.threadId, turnId: nativeTurnId, item: { id: 'commentary-1', type: 'agentMessage', text: 'I will inspect first.' } } });
      write({ method: 'item/started', params: { threadId: params.threadId, turnId: nativeTurnId, item: { id: 'reasoning-1', type: 'reasoning', summary: [], status: 'inProgress' } } });
      write({ method: 'item/reasoning/summaryTextDelta', params: { threadId: params.threadId, turnId: nativeTurnId, itemId: 'reasoning-1', summaryIndex: 0, delta: 'Checking the workspace.' } });
      write({ method: 'item/completed', params: { threadId: params.threadId, turnId: nativeTurnId, item: { id: 'reasoning-1', type: 'reasoning', summary: ['Checking the workspace.'], status: 'completed' } } });
      write({ method: 'item/started', params: { threadId: params.threadId, turnId: nativeTurnId, item: { id: 'command-1', type: 'commandExecution', status: 'inProgress', command: 'printf test', cwd: '/tmp' } } });
      write({ method: 'item/commandExecution/outputDelta', params: { threadId: params.threadId, turnId: nativeTurnId, itemId: 'command-1', delta: 'tool output\n' } });
      write({ method: 'item/completed', params: { threadId: params.threadId, turnId: nativeTurnId, item: { id: 'command-1', type: 'commandExecution', status: 'completed', command: 'printf test', cwd: '/tmp', aggregatedOutput: 'tool output\n', exitCode: 0 } } });
      completeTurn(params);
    } else if (params.input[0].text === 'approval please') {
      interactiveTurn = { kind: 'approval', requestId: 'provider-approval', params };
      write({ id: interactiveTurn.requestId, method: 'item/commandExecution/requestApproval', params: { threadId: params.threadId, turnId: nativeTurnId, itemId: 'tool-1', command: 'test', cwd: '/tmp' } });
    } else if (params.input[0].text === 'input please') {
      interactiveTurn = { kind: 'user-input', requestId: 'provider-input', params };
      write({ id: interactiveTurn.requestId, method: 'item/tool/requestUserInput', params: { threadId: params.threadId, turnId: nativeTurnId, itemId: 'tool-2', questions: [{ id: 'choice', header: 'Choice', question: 'Continue?', options: [] }] } });
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
