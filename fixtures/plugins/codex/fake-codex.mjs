#!/usr/bin/env node
import readline from 'node:readline';
import {appendFileSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
const write = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let nativeTurnId = 'native-turn';
const goalFile = process.env.CODEX_FAKE_GOAL_FILE;
let goal = goalFile && existsSync(goalFile) ? JSON.parse(readFileSync(goalFile,'utf8')) : null;
const nativeTurns = [];
const childThreads = new Map();
let interactiveTurn = null;
function completeTurn(params) {
  nativeTurns.push({id:nativeTurnId});
  write({ method: 'item/agentMessage/delta', params: { threadId: params.threadId, turnId: nativeTurnId, itemId: 'message', delta: params.input[0].text } });
  write({ method: 'item/completed', params: { threadId: params.threadId, turnId: nativeTurnId, item: { id: 'message', type: 'agentMessage', text: params.input[0].text } } });
  write({ method: 'thread/tokenUsage/updated', params: { threadId: params.threadId, turnId: nativeTurnId, tokenUsage: { total: { inputTokens: 1200, outputTokens: 34, totalTokens: 1234, modelContextWindow: 10000 } } } });
  write({ method: 'turn/completed', params: { threadId: params.threadId, turn: { id: nativeTurnId, status: 'completed', items: [] } } });
}
let goalTurnActive = false;
let goalTurnCount = 0;
function publishGoal(threadId) { if (goalFile) writeFileSync(goalFile,JSON.stringify(goal)); write({method:'thread/goal/updated',params:{threadId,goal}}); }
function startGoalTurn(threadId) {
  if (goal?.status !== 'active' || goalTurnActive) return;
  goalTurnActive = true;
  nativeTurnId = `goal-turn-${++goalTurnCount}`;
  write({method:'turn/started',params:{threadId,turn:{id:nativeTurnId,status:'inProgress'}}});
  if (process.env.CODEX_FAKE_GOAL_MODE === 'hold') return;
  setTimeout(() => {
    if (!goalTurnActive) return;
    goal.tokensUsed += 50; goal.timeUsedSeconds += 2;
    if (goalTurnCount % 2 === 0) { goal.status = 'complete'; publishGoal(threadId); }
    completeTurn({threadId,input:[{text:`Goal step ${goalTurnCount}`}]});
    goalTurnActive = false;
    if (goal.status === 'active') setTimeout(() => startGoalTurn(threadId), 20);
  }, 10);
}
input.on('line', (line) => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  if (request.method === undefined && interactiveTurn && String(request.id) === interactiveTurn.requestId) {
    if (interactiveTurn.kind === 'approval' && !['accept', 'cancel'].includes(request.result?.decision)) throw new Error('invalid approval response');
    if (interactiveTurn.kind === 'permissions' && request.result?.permissions?.fileSystem?.write?.[0] !== '.git') throw new Error('invalid permissions response');
    if (interactiveTurn.kind === 'user-input' && typeof request.result?.answers !== 'object') throw new Error('invalid user input response');
    completeTurn(interactiveTurn.params); interactiveTurn = null; return;
  }
  const { id, method, params = {} } = request;
  if (process.env.CODEX_FAKE_RPC_LOG && method) appendFileSync(process.env.CODEX_FAKE_RPC_LOG, `${method}\n`);
  if (method === 'account/rateLimits/read' && process.env.CODEX_FAKE_HOLD_QUOTA === '1') return;
  if ((method === 'thread/start' || method === 'thread/resume') && process.env.CODEX_FAKE_EXPECT_REVIEWER && params.approvalsReviewer !== process.env.CODEX_FAKE_EXPECT_REVIEWER) {
    write({id,error:{code:-32000,message:'expected native approvals reviewer'}}); return;
  }
  const policy = {approvalPolicy:params.approvalPolicy,approvalsReviewer:params.approvalsReviewer,model:params.model,sandbox:{type:process.env.CODEX_FAKE_SANDBOX ?? ({'read-only':'readOnly','workspace-write':'workspaceWrite','danger-full-access':'dangerFullAccess'}[params.sandbox])}};
  if (method === 'initialize') write({ id, result: { userAgent: 'fake-codex/1.0.0' } });
  else if (method === 'config/read') {
    const override = process.argv.find(arg => arg.startsWith('model_context_window='));
    write({id,result:{config:{model_context_window:override ? Number(override.split('=')[1]) : null,
      model_provider:process.env.CODEX_FAKE_CUSTOM_PROVIDER || null}}});
  }
  else if (method === 'account/rateLimits/read') write({ id, result: { rateLimits: { limitId: 'codex', limitName: '5 小时', planType: 'plus', primary: { usedPercent: 20, windowDurationMins: 300, resetsAt: 1900000000 }, secondary: { usedPercent: 40, windowDurationMins: 10080, resetsAt: 1900500000 }, credits: { balance: '12.5', hasCredits: true, unlimited: false } } } });
  else if (method === 'thread/start') write({ id, result: { thread: { id: process.env.CODEX_FAKE_THREAD_ID ?? 'native-thread' }, ...policy } });
  else if (method === 'thread/resume' && process.env.CODEX_FAKE_MISSING_ROLLOUT === '1') write({ id, error: { code: -32600, message: `no rollout found for thread id ${params.threadId}` } });
  else if (method === 'thread/resume' && process.env.CODEX_FAKE_REJECT_CONTEXT === '1' && process.argv.includes('model_context_window=872000')) write({id,error:{code:-32000,message:'Native context rejected'}});
  else if (method === 'thread/resume') write({ id, result: { thread: { id: params.threadId }, ...policy } });
  else if (method === 'thread/list') write({id,result:{data:[{id:'catalog-thread',title:'Catalog entry',cwd:params.cwd,status:{type:'idle'}}]}});
  else if (method === 'thread/read' && childThreads.has(params.threadId) && process.env.CODEX_FAKE_SUBAGENT_READ_FAIL === '1') write({id,error:{code:-32000,message:'Child history unavailable'}});
  else if (method === 'thread/read' && childThreads.has(params.threadId)) write({id,result:{thread:childThreads.get(params.threadId)}});
  else if (method === 'thread/read' && params.includeTurns && process.env.CODEX_FAKE_NO_TURNS === '1') write({id,error:{code:-32600,message:'list_turns is not supported yet'}});
  else if (method === 'thread/read') write({id,result:{thread:{id:params.threadId,title:'Native thread',cwd:process.cwd(),status:{type:'idle'},updatedAt:'2026-09-12T00:00:00Z',turns:process.env.CODEX_FAKE_NO_TURNS === '1' ? undefined : nativeTurns}}});
  else if (method === 'thread/fork') {
    if (params.lastTurnId && params.lastTurnId !== nativeTurnId) throw Error('host turn ID leaked into native fork');
    write({id,result:{thread:{id:process.env.CODEX_FAKE_FORK_SAME_THREAD==='1'?params.threadId:'forked-thread',parentThreadId:params.threadId}}});
  }
  else if (method === 'turn/steer') {
    if (params.expectedTurnId !== nativeTurnId) { write({id,error:{code:-32600,message:'expectedTurnId mismatch'}}); return; }
    if (params.input?.[0]?.text === 'reject steering') { write({id,error:{code:-32600,message:'steering rejected'}}); return; }
    write({id,result:{turnId:nativeTurnId}});
    write({method:'item/agentMessage/delta',params:{threadId:params.threadId,turnId:nativeTurnId,itemId:'steered',delta:params.input[0].text}});
  }
  else if (method === 'turn/start') {
    if (params.input?.[0]?.text === 'clipboard image fixture') {
      const image=params.input.find(item=>item.type==='localImage');
      if (!image || readFileSync(image.path).toString('base64') !== process.env.AIBO_FAKE_IMAGE_DATA) { write({id,error:{code:-32600,message:'Native image input missing or changed'}}); return; }
    }
    if (params.input?.[0]?.text?.startsWith('context:')) {
      const expected = params.input[0].text.slice(8);
      if (!process.argv.includes(`model_context_window=${expected}`)) {write({id,error:{code:-32000,message:'Native process context mismatch'}});return;}
    }
    nativeTurnId = params.input?.[0]?.text?.startsWith('unique turn:') ? params.input[0].text : 'native-turn';
    if (params.summary !== 'auto') {
      write({ id, error: { code: -32000, message: 'reasoning summary was not requested' } });
      return;
    }
    if (params.input?.[0]?.text === 'selected config' && (params.model !== 'gpt-fake' || params.reasoningEffort !== 'high' || params.serviceTier !== 'fast')) {
      write({ id, error: { code: -32000, message: 'selected model or reasoning effort missing' } });
      return;
    }
    write({ id, result: { turn: { id: nativeTurnId } } });
    write({ method: 'turn/started', params: { threadId: params.threadId, turn: { id: nativeTurnId, status: 'inProgress' } } });
    if (params.input[0].text === 'host queue delay') { setTimeout(()=>completeTurn(params), 600); }
    else if (params.input[0].text === 'subagent spawn fails') {
      write({method:'item/completed',params:{threadId:params.threadId,turnId:nativeTurnId,item:{type:'collabAgentToolCall',id:'failed-spawn',tool:'spawnAgent',status:'failed',receiverThreadIds:[],error:{message:'Agent limit reached'}}}});
      completeTurn(params);
    } else if (params.input[0].text === 'subagents please') {
      for (const [index,name] of ['Reader','Tester'].entries()) {
        const childId = `child-${index}`;
        const childTurn = {id:`child-turn-${index}`,status:'inProgress',items:[]};
        const thread = {id:childId,parentThreadId:params.threadId,agentNickname:name,preview:`Task ${name}`,status:{type:'active',activeFlags:[]},turns:[childTurn]};
        childThreads.set(childId,thread);
        if (process.env.CODEX_FAKE_SUBAGENT_POLL_ONLY !== '1') write({method:'thread/started',params:{thread}});
        write({method:'item/completed',params:{threadId:params.threadId,turnId:nativeTurnId,item:{type:'collabAgentToolCall',id:`spawn-${index}`,tool:'spawnAgent',status:'completed',senderThreadId:params.threadId,receiverThreadIds:[childId],prompt:`Task ${name}`,agentsStates:{[childId]:{status:'running',message:null}}}}});
        const childParams = {threadId:childId,turnId:childTurn.id};
        const thinking = {id:'thinking',type:'reasoning',summary:['Checking files.']};
        const command = {id:'command',type:'commandExecution',command:'ls',aggregatedOutput:'src\ntest',status:'completed'};
        if (process.env.CODEX_FAKE_SUBAGENT_POLL_ONLY !== '1') {
        write({method:'item/started',params:{...childParams,item:{...command,status:'inProgress'}}});
        write({method:'item/completed',params:{...childParams,item:command}});
        write({method:'item/completed',params:{...childParams,item:thinking}});
        write({method:'item/agentMessage/delta',params:{...childParams,itemId:'reply',delta:`${name} is working`}});
        }
        childTurn.items.push(command,thinking);
        setTimeout(() => {
          const reply = {id:'reply',type:'agentMessage',text:index ? 'Tests failed.' : 'Review complete.'};
          childTurn.items.push(reply); childTurn.status = index ? 'failed' : 'completed';
          if(index) childTurn.error = {message:'Test runner failed'};
          thread.status = {type:'idle'};
          if (process.env.CODEX_FAKE_SUBAGENT_POLL_ONLY !== '1') {
          write({method:'item/completed',params:{...childParams,item:reply}});
          write({method:'turn/completed',params:{threadId:childId,turn:childTurn}});
          }
        },50 + index*30);
      }
      write({method:'item/agentMessage/delta',params:{threadId:'unrelated',turnId:'foreign',itemId:'reply',delta:'foreign secret'}});
      completeTurn(params);
    } else if (params.input[0].text === 'tool please') {
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
    } else if (params.input[0].text === 'permissions please') {
      interactiveTurn = { kind: 'permissions', requestId: 'provider-permissions', params };
      write({ id: interactiveTurn.requestId, method: 'item/permissions/requestApproval', params: { threadId: params.threadId, turnId: nativeTurnId, itemId: 'tool-permissions', cwd: process.cwd(), startedAtMs: Date.now(), permissions: { fileSystem: { write: ['.git'] } } } });
    } else if (params.input[0].text === 'input please') {
      interactiveTurn = { kind: 'user-input', requestId: 'provider-input', params };
      write({ id: interactiveTurn.requestId, method: 'item/tool/requestUserInput', params: { threadId: params.threadId, turnId: nativeTurnId, itemId: 'tool-2', questions: [{ id: 'choice', header: 'Choice', question: 'Continue?', options: [] }] } });
    } else completeTurn(params);
  } else if (method === 'turn/interrupt') {
    if (process.env.CODEX_FAKE_INTERRUPT_FAIL === '1') {write({id,error:{code:-32000,message:'interrupt failed'}});return;}
    write({id,result:{}});
    goalTurnActive = false; interactiveTurn = null;
    write({method:'turn/completed',params:{threadId:params.threadId,turn:{id:params.turnId,status:'interrupted',items:[]}}});
  }
  else if (method === 'thread/goal/get') write({ id, result: { goal } });
  else if (method === 'thread/goal/set') {
    if (process.env.CODEX_FAKE_GOAL_RESUME_FAIL === '1' && params.status === 'active') {write({id,error:{code:-32000,message:'resume rejected'}});return;}
    if (params.objective !== undefined && params.objective !== goal?.objective) {
      goal = {threadId:params.threadId,objective:params.objective,tokenBudget:params.tokenBudget ?? null,status:params.status ?? 'active',tokensUsed:0,timeUsedSeconds:0};
    } else if (!goal) {write({id,error:{code:-32600,message:'goal missing'}});return;}
    if (params.status !== undefined) goal.status = params.status;
    if (params.tokenBudget !== undefined) goal.tokenBudget = params.tokenBudget;
    write({ id, result: { goal } });
    publishGoal(params.threadId);
    if (params.status === 'active' && process.env.CODEX_FAKE_GOAL_MODE) setTimeout(() => startGoalTurn(params.threadId), 5);
  } else if (method === 'thread/goal/clear') {
    goal = null;
    if (goalFile) writeFileSync(goalFile,JSON.stringify(goal));
    write({ id, result: { goal } });
  } else if (method === 'model/list') write({ id, result: { data: [{ id: 'gpt-fake', model: 'gpt-fake', displayName: 'GPT Fake', isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }], serviceTiers: [{ id: 'priority', name: 'Fast', description: 'Faster responses' }] }] } });
  else if (method === 'skills/list') write({ id, result: { data: [{ cwd: params.cwds[0], skills: [{ name: 'review', interface: { shortDescription: 'Review code' } }] }] } });
});
