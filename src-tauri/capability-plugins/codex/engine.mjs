import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

const pluginId = 'dev.aibo.codex';
const pluginVersion = '2.0.15';

export const capabilities = ['session.create', 'session.resume', 'session.close', 'turn.send', 'image.input', 'turn.cancel', 'queue.manage', 'stream.text', 'goal.manage', 'goal.pause', 'goal.resume', 'model.select', 'model.reasoning', 'model.service-tier', 'model.context-window', 'skill.list', 'approval.respond', 'user-input.respond', 'session.snapshot', 'session.fork'];
let child = null;
let childLines = null;
let nextId = 1;
let session = null;
let modelDiscovery = null;
const MODEL_CATALOG_TTL_MS = 60_000;
const pending = new Map();
const providerRequests = new Map();

let publish, hostHistoryTool;
export function hostToolsRegistered() { return !!session?.hostTools?.length; }
export function configure(callbacks) { publish = callbacks.emit; hostHistoryTool=callbacks.requestHostTool; }
const fail = (kind, message = kind) => { throw Object.assign(new Error(message), { kind }); };
const emit = (type, payload, turnId = null, correlation = null) => publish({
  nativeSessionId: session.eventSessionId ?? session.threadId, turnId, type, correlation, payload,
});
function rateLimitUsage(result) {
  const snapshot = result?.rateLimits;
  if (!snapshot || typeof snapshot !== 'object') return null;
  const limits = ['primary', 'secondary'].flatMap((kind) => {
    const window = snapshot[kind];
    if (!window || typeof window.usedPercent !== 'number') return [];
    return [{ id: `${snapshot.limitId ?? 'default'}-${kind}`, label: kind === 'primary' ? snapshot.limitName ?? null : null,
      usedPercent: window.usedPercent, windowMinutes: typeof window.windowDurationMins === 'number' ? window.windowDurationMins : null,
      resetsAt: typeof window.resetsAt === 'number' ? window.resetsAt : null }];
  });
  const credits = snapshot.credits && typeof snapshot.credits === 'object'
    ? { balance: typeof snapshot.credits.balance === 'string' ? snapshot.credits.balance : null, unlimited: snapshot.credits.unlimited === true }
    : null;
  return { plan: typeof snapshot.planType === 'string' ? snapshot.planType : null, limits, credits };
}
function publishUsage() {
  if (!session) return;
  const usage = { ...(session.tokenUsage ?? {}), ...(session.rateLimitUsage ?? {}) };
  if (Object.keys(usage).length) emit('usage.updated', { usage }, session.turn?.id ?? null);
}
async function refreshRateLimits() {
  const target = session;
  const startedChild = child;
  try {
    const result = await rpc('account/rateLimits/read', {}, 5_000);
    if (!target || session !== target || child !== startedChild) return;
    target.rateLimitUsage = rateLimitUsage(result);
    publishUsage();
  } catch {
    // Account metadata is optional; token usage remains available without it.
  }
}

// The model and reasoning controls consume the same native directory. Share
// discovery within this process, while allowing subsequent refreshes to expire it.
function nativeModels() {
  if (modelDiscovery && modelDiscovery.expiresAt > Date.now()) return modelDiscovery.promise;
  const entry = { expiresAt: Date.now() + MODEL_CATALOG_TTL_MS, promise: null };
  entry.promise = rpc('model/list', {limit:100, includeHidden:false}).catch(error => {
    if (modelDiscovery === entry) modelDiscovery = null;
    throw error;
  });
  modelDiscovery = entry;
  return entry.promise;
}

function recovery() {
  return { schema: 'dev.aibo.codex.recovery', version: 1, data: {
    threadId: session.threadId,
    model: session.model,
    reasoningEffort: session.reasoningEffort,
    serviceTier: session.serviceTier,
    contextWindow: session.contextWindow,
    hostToolNames:session.hostTools?.map(tool=>tool.name)??[],
  } };
}
// model/list omits context bounds. Use the native, freshly downloaded catalog,
// never API marketing limits or another provider's same-named model.
async function contextCatalog(models) {
  try {
    const {config} = await rpc('config/read', {includeLayers:false});
    if (config.model_catalog_json || (config.model_provider && config.model_provider !== 'openai')
      || config.model_providers?.openai?.base_url) return new Map();
    const home = process.env.CODEX_HOME || path.join(homedir(), '.codex');
    const cache = JSON.parse(await readFile(path.join(home, 'models_cache.json'), 'utf8'));
    const age = Date.now() - Date.parse(cache.fetched_at);
    if (!Number.isFinite(age) || age < -60_000 || age > 86_400_000 || !Array.isArray(cache.models)) return new Map();
    return new Map(models.flatMap(model => {
      const native = cache.models.find(item => item.slug === model.model);
      const base = native?.context_window, max = native?.max_context_window;
      if (!Number.isSafeInteger(base) || base <= 0 || !Number.isSafeInteger(max) || max <= base) return [];
      return [[model.model, [base, max].map(tokens => ({id:String(tokens), tokens,
        label:`${tokens / 1000}K`, description:tokens === base ? 'Codex 模型目录默认窗口' : 'Codex 模型目录最大窗口'}))]];
    }));
  } catch { return new Map(); }
}
async function modelCatalog() {
  const result = await nativeModels();
  const models = result?.data ?? [];
  const contexts = await contextCatalog(models);
  const current = session.model ?? models.find(model => model.isDefault)?.model ?? null;
  const options = contexts.get(current) ?? [];
  // Read the running process configuration, rather than echoing the requested ID.
  let configured = null;
  try { configured = (await rpc('config/read', {includeLayers:false})).config.model_context_window; } catch {}
  const actual = configured ?? options[0]?.tokens;
  return {current, currentServiceTier:session.serviceTier,
    currentContextWindow:options.find(option => option.tokens === actual)?.id ?? null,
    models:models.map(model => ({...model, contextWindows:contexts.get(model.model) ?? []}))};
}
async function switchContextWindow(contextWindow, targetModel = null) {
  if (session.turn || session.changingContext) fail('busy');
  const catalog = await modelCatalog();
  const model = catalog.models.find(model => model.model === catalog.current);
  if (!targetModel && !model?.contextWindows.some(option => option.id === contextWindow)) fail('invalid_request', 'Context window is not supported by the native model catalog');
  const previous = session;
  previous.changingContext = true;
  const restore = async (window, selectedModel) => {
    await stopCodex(); session = null;
    await execute('resume', {sessionId:previous.id, workspace:{path:previous.cwd},
      eventSessionId:previous.eventSessionId ?? previous.threadId, suppressStarted:true,hostTools:previous.hostTools,
      executionProfile:{...previous.executionProfile, model:selectedModel, reasoningEffort:previous.reasoningEffort},
      binding:{pluginId, recovery:{schema:'dev.aibo.codex.recovery',version:1,data:{
        threadId:previous.threadId, model:selectedModel,hostToolNames:previous.hostTools?.map(tool=>tool.name)??[],
        reasoningEffort:previous.reasoningEffort, serviceTier:previous.serviceTier, contextWindow:window}}}});
  };
  try {
    await restore(contextWindow, targetModel ?? catalog.current);
    const confirmed = await modelCatalog();
    if (!targetModel && confirmed.currentContextWindow !== contextWindow) fail('invalid_output', 'Codex did not apply the context window');
    publishRecovery();
    return confirmed;
  } catch (error) {
    try { await restore(previous.contextWindow, previous.model ?? catalog.current); }
    catch { session = null; await stopCodex(); }
    throw error;
  } finally { previous.changingContext = false; }
}
function publishRecovery() { emit('session.info_changed', { recovery: recovery() }); }
const boundedText = (value, max = 4_000) => {
  if (typeof value !== 'string') return null;
  const chars = Array.from(value);
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : value;
};
// Child work belongs to the parent session, but has its own lifecycle and item IDs.
const subagents = new Map();
let subagentTimer = null;
const activeSubagent = agent => ['running', 'pending', 'waiting'].includes(agent.status);
function publishSubagent(agent) {
  const {entries, reading, failures, revision, published, nativeTurnId, ...metadata} = agent;
  const serialized = JSON.stringify(metadata);
  if (serialized === agent.published) return;
  agent.published = serialized;
  emit('subagent.updated', metadata);
}
function registerSubagent(id, parentId, details = {}) {
  if (!session?.turn || !id || id === session.threadId || (parentId !== session.threadId && !subagents.has(parentId))) return null;
  let agent = subagents.get(id);
  if (!agent) {
    agent = {id, parentId, rootTurnId:session.turn?.id ?? null, name:details.name || '子 Agent', task:details.task || '',
      status:'pending', activity:'正在启动…', entries:new Map(), failures:0, revision:0};
    subagents.set(id, agent);
  }
  if (details.name) agent.name = details.name;
  if (details.task) agent.task = boundedText(details.task, 12000);
  publishSubagent(agent);
  scheduleSubagents();
  return agent;
}
function setSubagentStatus(agent, status, message) {
  const mapped = {pendingInit:'pending',running:'running',completed:'completed',errored:'failed',failed:'failed',interrupted:'interrupted',shutdown:'closed',notFound:'unavailable'}[status];
  if (mapped) { agent.status = mapped; agent.revision++; }
  if (mapped && !activeSubagent(agent)) for (const [id, entry] of agent.entries) if (entry.status === 'streaming') {
    const updated = {...entry, status:mapped === 'completed' ? 'completed' : mapped === 'failed' ? 'failed' : 'interrupted'};
    agent.entries.set(id, updated);
    emit('subagent.message', {agentId:agent.id, rootTurnId:agent.rootTurnId, entry:updated});
  }
  if (message) agent.activity = boundedText(message, 12000);
  publishSubagent(agent);
}
function childItem(agent, turnId, item, completed = false, delta = null) {
  if (!item?.id || item.type === 'collabAgentToolCall') return;
  const id = `${turnId ?? 'thread'}:${item.id}`;
  const previous = agent.entries.get(id);
  const role = item.type === 'agentMessage' ? 'assistant' : item.type === 'userMessage' ? 'user' : item.type === 'reasoning' ? 'system' : 'tool';
  let content = item.type === 'reasoning' ? (item.summary ?? []).map(part => typeof part === 'string' ? part : part.text ?? '').join('\n')
    : item.type === 'userMessage' ? (item.content ?? []).map(part => part.text ?? '').join('\n')
    : item.text ?? item.aggregatedOutput ?? item.output ?? item.command ?? item.description;
  if (typeof content !== 'string') content = content ? JSON.stringify(content) : previous?.content ?? '';
  if (delta !== null) content = (previous?.content ?? '') + delta;
  const entry = {id, role:previous?.role ?? role, toolName:previous?.toolName ?? (role === 'system' ? 'reasoning' : role === 'tool' ? item.type : null),
    content:boundedText(content, 48000) ?? '', status: ['failed','error','declined'].includes(item.status) ? 'failed' : completed || previous?.status === 'completed' ? 'completed' : 'streaming'};
  if (JSON.stringify(entry) === JSON.stringify(previous)) return;
  agent.entries.set(id, entry); agent.revision++;
  emit('subagent.message', {agentId:agent.id, rootTurnId:agent.rootTurnId, entry});
  agent.activity = boundedText(content.trim().split('\n').filter(Boolean).at(-1) || (role === 'system' ? '正在思考…' : `正在执行 ${item.type}…`), 240);
  publishSubagent(agent);
}
function collabItem(item, parentId) {
  if (item?.type === 'subAgentActivity') {
    const agent = subagents.get(item.agentThreadId) ?? registerSubagent(item.agentThreadId, parentId, {name:item.agentPath});
    if (agent) void readSubagent(agent);
    return true;
  }
  if (!['collabAgentToolCall','collabToolCall'].includes(item?.type)) return false;
  const ids = item.receiverThreadIds ?? [item.newThreadId ?? item.receiverThreadId].filter(Boolean);
  if (!ids.length && item.status === 'failed') return false; // Preserve a failed dispatch in the normal tool timeline.
  for (const id of ids) {
    let agent = subagents.get(id);
    if (!agent && ['spawnAgent','spawn_agent'].includes(item.tool)) agent = registerSubagent(id, parentId, {task:item.prompt});
    if (!agent) continue;
    const state = item.agentsStates?.[id] ?? item.agentStatus;
    if (state) setSubagentStatus(agent, typeof state === 'string' ? state : state.status, state.message);
    // A completed spawn only acknowledges dispatch; it does not finish the child.
    if (item.tool === 'closeAgent' && item.status === 'completed' && activeSubagent(agent)) setSubagentStatus(agent,'shutdown');
    void readSubagent(agent);
  }
  return true;
}
async function readSubagent(agent) {
  if (agent.reading || !session?.turn) return;
  agent.reading = true;
  const currentSession = session;
  const revision = agent.revision;
  try {
    const result = await rpc('thread/read', {threadId:agent.id, includeTurns:true}, 5000);
    if (session !== currentSession || !session.turn) return;
    const thread = result?.thread;
    if (thread?.id !== agent.id || !Array.isArray(thread.turns)) throw new Error('Child history unavailable');
    agent.failures = 0;
    if (revision !== agent.revision) return; // Live notifications supersede an in-flight snapshot.
    if (thread.agentNickname) agent.name = thread.agentNickname;
    for (const turn of thread.turns) for (const item of turn.items ?? []) {
      if (!collabItem(item, agent.id)) childItem(agent, turn.id, item, turn.status !== 'inProgress' || item.status === 'completed');
    }
    const last = thread.turns.at(-1);
    agent.nativeTurnId = last?.status === 'inProgress' ? last.id : null;
    if (last?.status === 'inProgress') agent.status = thread.status?.activeFlags?.length ? 'waiting' : 'running';
    else if (last?.status && !['closed','failed'].includes(agent.status)) setSubagentStatus(agent, last.status, last.error?.message);
    publishSubagent(agent);
  } catch {
    if (session === currentSession && session.turn && ++agent.failures >= 3) {
      agent.status = 'unavailable'; agent.activity = '暂时无法读取子 Agent 的过程，已保留收到的记录。'; publishSubagent(agent);
    }
  } finally { agent.reading = false; }
}
function scheduleSubagents() {
  if (subagentTimer || !session?.turn) return;
  subagentTimer = setTimeout(async () => {
    subagentTimer = null;
    await Promise.all([...subagents.values()].filter(activeSubagent).map(readSubagent));
    const turn = session?.turn;
    if (turn?.childCompletion && ![...subagents.values()].some(agent => activeSubagent(agent) || agent.reading)) finishTurn(turn,turn.childCompletion);
    else if ([...subagents.values()].some(activeSubagent)) scheduleSubagents();
  }, 700);
}
function childNotification(method, p) {
  if (method === 'thread/started') {
    const thread = p.thread;
    const source = thread?.source?.subAgent?.thread_spawn;
    registerSubagent(thread?.id, thread?.parentThreadId ?? source?.parent_thread_id, {name:thread?.agentNickname ?? source?.agent_nickname, task:thread?.preview});
  }
  const agent = subagents.get(p.threadId);
  if (!agent) return false;
  if (!session.turn) return true;
  if (collabItem(p.item, agent.id)) return true;
  if (method === 'turn/started') { agent.nativeTurnId = p.turn?.id; setSubagentStatus(agent,'running'); }
  else if (method === 'turn/completed') {
    for (const item of p.turn?.items ?? []) childItem(agent,p.turn.id,item,true);
    setSubagentStatus(agent,p.turn?.status,p.turn?.error?.message);
    void readSubagent(agent);
  } else if (method === 'thread/status/changed') {
    if (p.status?.type === 'systemError') setSubagentStatus(agent,'errored');
    else if (p.status?.type === 'active') { agent.status = p.status.activeFlags?.length ? 'waiting' : 'running'; publishSubagent(agent); }
  } else if (method === 'item/started' || method === 'item/completed') childItem(agent,p.turnId,p.item,method === 'item/completed');
  else if (['item/agentMessage/delta','item/reasoning/summaryTextDelta','item/commandExecution/outputDelta'].includes(method)) {
    childItem(agent,p.turnId,{id:p.itemId,type:method.includes('agentMessage')?'agentMessage':method.includes('reasoning')?'reasoning':'commandExecution'},false,p.delta ?? '');
  }
  scheduleSubagents();
  return true;
}

function toolEventType(method) {
  if (method === 'item/started') return 'tool.started';
  if (['item/updated', 'item/commandExecution/outputDelta', 'item/fileChange/outputDelta', 'item/mcpToolCall/progress'].includes(method)) return 'tool.updated';
  if (method === 'item/completed') return 'tool.completed';
  return null;
}
function toolProjection(method, params) {
  const type = toolEventType(method);
  if (!type) return null;
  const item = params.item ?? params;
  const itemId = params.itemId ?? item.id;
  const itemType = item.type ?? params.kind ?? method.split('/')[1] ?? 'tool';
  if (typeof itemId !== 'string' || !itemId || !/(command|file|tool|shell|search|computer|patch|diff|edit)/i.test(itemType)) return null;
  const command = boundedText(item.command ?? params.command);
  const cwd = boundedText(item.cwd ?? params.cwd);
  const output = boundedText(item.aggregatedOutput ?? item.output ?? item.stdout ?? item.stderr, 12_000);
  const delta = boundedText(params.delta);
  const primary = item.command ?? item.path ?? item.filePath ?? item.toolName ?? item.name ?? item.description ?? item.text ?? item.error?.message ?? item.prompt ?? item.tool;
  const summary = boundedText([primary, output].filter((value) => typeof value === 'string' && value).join('\n'), 12_000) ?? itemType;
  return { type, payload: { itemId, itemType, status: item.status ?? (type === 'tool.completed' ? 'completed' : 'inProgress'),
    summary, delta, output, command, cwd, exitCode: item.exitCode ?? item.exit_code ?? item.returnCode ?? params.exitCode ?? null } };
}
function rpc(method, params, timeoutMs = 0) {
  const id = `codex-${nextId++}`;
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  return new Promise((resolve, reject) => {
    const timer = timeoutMs ? setTimeout(() => { pending.delete(id); reject(new Error(`Codex ${method} timed out`)); }, timeoutMs) : null;
    pending.set(id, {resolve: value => {clearTimeout(timer); resolve(value);}, reject: error => {clearTimeout(timer); reject(error);}});
  });
}
function notify(method, params) { child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`); }
function isMissingRolloutError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return normalized.includes('no rollout found')
    || normalized.includes('thread not loaded')
    || normalized.includes('thread not found');
}
function nativeApprovalReviewer(reviewer) {
  return reviewer === 'auto-review' ? 'auto_review' : reviewer === 'user' ? 'user' : null;
}
function validateThreadPolicy(result, approvalPolicy, approvalsReviewer, sandbox, model) {
  const sandboxType = {'read-only':'readOnly','workspace-write':'workspaceWrite','danger-full-access':'dangerFullAccess'}[sandbox];
  if (result?.approvalPolicy !== approvalPolicy || (approvalsReviewer && result?.approvalsReviewer !== approvalsReviewer) || !sandboxType || result?.sandbox?.type !== sandboxType) fail('invalid_output','Codex did not enforce the requested approval and sandbox policy');
  if (model && result.model !== model) fail('invalid_output','Codex did not select the requested model');
}
async function startThread(cwd, approvalPolicy, approvalsReviewer, sandbox, model, hostTools=[]) {
  const result = await rpc('thread/start', {
    cwd,
    approvalPolicy,
    ...(approvalsReviewer ? {approvalsReviewer} : {}),
    sandbox,
    serviceName: 'aibo_codex_plugin',
    ...(hostTools.length?{dynamicTools:hostTools.map(({name,description,inputSchema})=>({type:'function',name,description,inputSchema}))}:{}),
    ...(model ? {model} : {}),
  });
  validateThreadPolicy(result, approvalPolicy, approvalsReviewer, sandbox, model);
  const threadId = result?.thread?.id;
  if (!threadId) fail('invalid_session', 'Codex did not return a thread id');
  return {threadId, model:result.model};
}
function updateGoal(goal) {
  if (JSON.stringify(session.goal) === JSON.stringify(goal)) return;
  session.goal = goal;
  session.goalRevision = (session.goalRevision ?? 0) + 1;
  emit('goal.updated', { goal });
  const turn = session.turn;
  if (turn?.waitingForGoal && goal?.status !== 'active') finishTurn(turn, turn.lastStatus ?? 'completed');
}
async function readGoal() {
  const revision = session.goalRevision;
  const result = await rpc('thread/goal/get', { threadId: session.threadId }, 10000);
  if (session.goalRevision === revision) updateGoal(result?.goal ?? null);
  return session.goal;
}
function newTurn(p) {
  return { id:p.turnId, requestId:p.requestId, nativeId:null, nativeSequence:0, itemId:null, text:'',
    reasoningItems:new Set(), itemTexts:new Map(), completedMessages:new Set(), waitingForGoal:false, timer:null };
}
function finishTurn(turn, status) {
  if (session.turn !== turn) return;
  if (status === 'completed' && [...subagents.values()].some(agent => activeSubagent(agent) || agent.reading)) {
    turn.childCompletion = status; scheduleSubagents(); return;
  }
  if (status !== 'completed') for (const agent of subagents.values()) if (activeSubagent(agent)) setSubagentStatus(agent,'interrupted','父任务已结束，过程记录已保留。');
  clearTimeout(subagentTimer); subagentTimer = null;
  clearTimeout(turn.timer);
  session.turn = null;
  providerRequests.clear();
  emit(status === 'failed' ? 'turn.failed' : 'turn.completed', status === 'failed' ? { message:'Codex turn failed' } : { status }, turn.id,
    { requestId:turn.requestId, itemId:null });
}
function waitForGoalTurn(turn) {
  if (session.turn !== turn || turn.nativeId) return;
  turn.waitingForGoal = true;
  clearTimeout(turn.timer);
  // Never leave the host claiming execution forever if the native runtime did not start.
  turn.timer = setTimeout(async () => {
    if (session.turn !== turn || turn.nativeId) return;
    turn.lastStatus = 'failed';
    try { updateGoal((await rpc('thread/goal/set', {threadId:session.threadId,status:'paused'}, 5000))?.goal ?? null); }
    catch { /* The terminal event still releases host execution ownership. */ }
    finishTurn(turn, 'failed');
  }, 30000);
}
async function finishNativeTurn(turn, nativeId, status) {
  if (session.turn !== turn || turn.nativeId !== nativeId) return;
  turn.nativeId = null;
  turn.lastStatus = status;
  if (status !== 'completed') { finishTurn(turn,status); return; }
  try { await readGoal(); }
  catch {
    if (session.turn === turn && !turn.nativeId) {
      if (session.goal?.status === 'active') waitForGoalTurn(turn);
      else finishTurn(turn,status);
    }
    return;
  }
  if (session.turn !== turn || turn.nativeId) return;
  if (session.goal?.status === 'active') waitForGoalTurn(turn);
  else finishTurn(turn,status);
}
async function pauseGoal() {
  await session.goalStarting;
  // Persist pause first, so an interrupt cannot trigger another goal continuation.
  const result = await rpc('thread/goal/set', {threadId:session.threadId,status:'paused'}, 5000);
  updateGoal(result?.goal ?? null);
  const turn = session.turn;
  if (turn?.nativeId) {
    const nativeId = turn.nativeId;
    try { await rpc('turn/interrupt', {threadId:session.threadId,turnId:nativeId}, 5000); }
    catch (error) {
      // Completion/continuation may race the first interrupt. Retry only a new live turn.
      if (session.turn === turn && turn.nativeId && turn.nativeId !== nativeId) {
        await rpc('turn/interrupt', {threadId:session.threadId,turnId:turn.nativeId}, 5000);
      } else if (session.turn === turn && turn.nativeId) throw error;
    }
  } else if (turn) finishTurn(turn,'interrupted');
  return result;
}
function onCodex(message) {
  if (message.id !== undefined && pending.has(String(message.id))) {
    const request = pending.get(String(message.id)); pending.delete(String(message.id));
    message.error ? request.reject(Object.assign(new Error(message.error.message ?? 'Codex request failed'), {nativeRejected:true})) : request.resolve(message.result);
    return;
  }
  if (message.id !== undefined && message.method === 'item/tool/call') {
    const p=message.params??{}, turn=session?.turn, process=child;
    const reply=(success,text)=>{if(child===process && child?.stdin?.writable)child.stdin.write(`${JSON.stringify({jsonrpc:'2.0',id:message.id,result:{success,contentItems:[{type:'inputText',text}]}})}\n`);};
    if(!turn || p.threadId!==session.threadId || p.turnId!==turn.nativeId || p.namespace != null || !session.hostTools?.some(tool=>tool.name===p.tool)) {
      reply(false,'Host tool identity or availability mismatch');return;
    }
    Promise.resolve().then(()=>hostHistoryTool(p.tool,p.arguments)).then(result=>{
      if(session?.turn!==turn)reply(false,'Host tool turn ended');else reply(true,JSON.stringify(result));
    },error=>reply(false,String(error.message??error).slice(0,4096)));
    return;
  }
  if (message.id !== undefined && message.method?.endsWith('/requestApproval')) {
    const requestId = String(message.id); const permissions = message.method === 'item/permissions/requestApproval' ? message.params?.permissions ?? {} : null;
    providerRequests.set(requestId, { rawId: message.id, kind: 'approval', permissions });
    emit('approval.requested', { requestId, kind: permissions ? 'permissions' : message.params?.kind ?? null, command: permissions ? boundedText(JSON.stringify(permissions), 4_000) : message.params?.command ?? null,
      cwd: message.params?.cwd ?? null, availableDecisions: ['accept', 'cancel'] }, session?.turn?.id ?? null,
      { requestId, itemId: message.params?.itemId ?? null, approvalId: message.id }); return;
  }
  if (message.id !== undefined && (message.method === 'item/tool/requestUserInput' || message.method === 'tool/requestUserInput')) {
    const requestId = String(message.id); providerRequests.set(requestId, { rawId: message.id, kind: 'user-input' });
    emit('user_input.requested', { requestId, questions: message.params?.questions ?? [] }, session?.turn?.id ?? null,
      { requestId, itemId: message.params?.itemId ?? null }); return;
  }
  if (!session || !message.method) return;
  let p = message.params ?? {};
  if (childNotification(message.method, p)) return;
  if (p.threadId && p.threadId !== session.threadId) return;
  if (message.method === 'thread/goal/updated') { updateGoal(p.goal ?? null); return; }
  if (message.method === 'thread/goal/cleared') { updateGoal(null); return; }
  const turn = session.turn;
  if (turn && collabItem(p.item, session.threadId)) return;
  if (turn && p.turnId && turn.nativeId && p.turnId !== turn.nativeId) return;
  if (turn?.nativeSequence > 1 && message.method.startsWith('item/')) {
    const scoped = id => id ? `${turn.nativeId}:${id}` : id;
    p = {...p, itemId:scoped(p.itemId), ...(p.item ? {item:{...p.item,id:scoped(p.item.id)}} : {})};
  }
  if (message.method === 'turn/started' && turn) {
    clearTimeout(turn.timer);
    turn.waitingForGoal = false;
    turn.nativeSequence++;
    turn.nativeId = p.turn?.id ?? null;
    turn.itemId = null; turn.text = ''; turn.itemTexts.clear(); turn.completedMessages.clear(); turn.reasoningItems.clear();
    emit('turn.started', { nativeTurnId: turn.nativeId }, turn.id, { requestId: turn.requestId, itemId: null });
  } else if (message.method === 'item/agentMessage/delta' && turn) {
    const delta = typeof p.delta === 'string' ? p.delta : '';
    if (p.itemId) turn.itemId = p.itemId;
    if (delta) {
      turn.text += delta;
      if (turn.itemId) turn.itemTexts.set(turn.itemId, `${turn.itemTexts.get(turn.itemId) ?? ''}${delta}`);
      emit('message.delta', { itemId: turn.itemId, delta }, turn.id, { requestId: turn.requestId, itemId: turn.itemId });
    }
  } else if (message.method === 'thread/tokenUsage/updated' && turn && p.threadId === session.threadId) {
    session.tokenUsage = p.tokenUsage && typeof p.tokenUsage === 'object' ? p.tokenUsage : null;
    publishUsage();
  } else if (message.method === 'account/rateLimits/updated') {
    void refreshRateLimits();
  } else if (message.method === 'item/reasoning/summaryTextDelta' && turn && typeof p.itemId === 'string' && typeof p.delta === 'string' && p.delta) {
    turn.reasoningItems.add(p.itemId);
    emit('reasoning.updated', { itemId: p.itemId, delta: boundedText(p.delta) }, turn.id, { requestId: turn.requestId, itemId: p.itemId });
  } else if (message.method === 'item/completed' && turn && p.item?.type === 'reasoning') {
    const summary = Array.isArray(p.item.summary) ? boundedText(p.item.summary.filter((part) => typeof part === 'string').join('\n'), 12_000) : null;
    if (summary || turn.reasoningItems.has(p.item.id)) {
      emit('reasoning.completed', { itemId: p.item.id, summary }, turn.id, { requestId: turn.requestId, itemId: p.item.id });
    }
  } else if (turn && toolProjection(message.method, p)) {
    const tool = toolProjection(message.method, p);
    emit(tool.type, tool.payload, turn.id, { requestId: turn.requestId, itemId: tool.payload.itemId });
  } else if (message.method === 'item/completed' && turn && p.item?.type === 'agentMessage') {
    if (p.item?.id) turn.itemId = p.item.id;
    const text = typeof p.item.text === 'string' ? p.item.text : turn.itemTexts.get(p.item?.id) ?? '';
    if (p.item?.id && text) {
      turn.completedMessages.add(p.item.id);
      emit('message.completed', { itemId: p.item.id, text }, turn.id, { requestId: turn.requestId, itemId: p.item.id });
    }
  } else if (message.method === 'turn/completed' && turn && p.turn?.id === turn.nativeId) {
    const nativeStatus = p.turn?.status;
    const status = nativeStatus === 'completed' ? 'completed' : nativeStatus === 'interrupted' ? 'interrupted' : 'failed';
    for (const item of p.turn?.items?.filter((candidate) => candidate?.type === 'agentMessage') ?? []) {
      const itemId = turn.nativeSequence > 1 ? `${turn.nativeId}:${item.id}` : item.id;
      if (item.id && typeof item.text === 'string' && item.text && !turn.completedMessages.has(itemId)) {
        turn.completedMessages.add(itemId);
        emit('message.completed', { itemId, text: item.text }, turn.id, { requestId: turn.requestId, itemId });
      }
    }
    if (turn.completedMessages.size === 0 && turn.text) {
      const itemId = turn.itemId ?? `assistant-${turn.nativeId}`;
      emit('message.completed', { itemId, text: turn.text }, turn.id, { requestId: turn.requestId, itemId });
    }
    void finishNativeTurn(turn, p.turn.id, status);
  }
}
async function startCodex(cwd, contextWindow = null) {
  child = spawn('codex', ['app-server', '--stdio', ...(contextWindow ? ['-c', `model_context_window=${Number(contextWindow)}`, '-c', `model_auto_compact_token_limit=${Math.floor(Number(contextWindow) * 0.9)}`] : [])], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  const startedChild = child;
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  child.on('exit', () => {
    // A close followed immediately by resume can leave the old child exit
    // notification queued after the replacement child has started. Only the
    // current provider process may reject the current request set.
    if (child !== startedChild) return;
    for (const request of pending.values()) request.reject(new Error('Codex exited'));
    pending.clear();
    if (session?.turn) finishTurn(session.turn, 'failed');
  });
  childLines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  childLines.on('line', (line) => { try { onCodex(JSON.parse(line)); } catch (error) { process.stderr.write(`Invalid Codex frame: ${error}\n`); } });
  await rpc('initialize', { clientInfo: { name: 'aibo_codex_plugin', title: 'Aibo Codex Plugin', version: pluginVersion }, capabilities: { experimentalApi: true } });
  notify('initialized', {});
}
async function stopCodex() {
  modelDiscovery = null;
  clearTimeout(subagentTimer); subagentTimer = null; subagents.clear();
  if (!child) return;
  clearTimeout(session?.turn?.timer);
  childLines?.close(); child.kill(); child = null;
  for (const request of pending.values()) request.reject(new Error('Codex stopped')); pending.clear();
}
export async function execute(action, p) {
  if (action === 'create' || action === 'resume') {
    if (session || !p.workspace?.path) fail('permission_denied');
    const recoveryModel = p.binding?.recovery?.data?.model;
    const contextWindow = p.executionProfile?.model && p.executionProfile.model !== recoveryModel
      ? null : p.binding?.recovery?.data?.contextWindow ?? null;
    if (contextWindow !== null && (typeof contextWindow !== 'string' || !/^[1-9][0-9]*$/.test(contextWindow) || !Number.isSafeInteger(Number(contextWindow)))) fail('invalid_recovery_data');
    await startCodex(p.workspace.path, contextWindow);
    if (contextWindow) {
      try {
        const models = (await nativeModels()).data ?? [];
        const current = p.executionProfile?.model ?? p.binding?.recovery?.data?.model ?? models.find(model => model.isDefault)?.model;
        const options = (await contextCatalog(models)).get(current) ?? [];
        const config = (await rpc('config/read', {includeLayers:false})).config;
        if (!options.some(option => option.id === contextWindow) || config.model_context_window !== Number(contextWindow)) fail('invalid_recovery_data', 'Native context specification is unavailable or was not applied');
      } catch (error) { await stopCodex(); throw error; }
    }
    const approvalPolicy = typeof p.executionProfile?.approvalPolicy === 'string'
      ? p.executionProfile.approvalPolicy
      : 'untrusted';
    const approvalsReviewer = nativeApprovalReviewer(p.executionProfile?.approvalReviewer);
    const sandbox = typeof p.executionProfile?.filesystemPolicy === 'string'
      ? p.executionProfile.filesystemPolicy
      : 'read-only';
    const model = typeof p.executionProfile?.model === 'string' ? p.executionProfile.model : p.binding?.recovery?.data?.model ?? null;
    const reasoningEffort = typeof p.executionProfile?.reasoningEffort === 'string' ? p.executionProfile.reasoningEffort : p.binding?.recovery?.data?.reasoningEffort ?? null;
    const serviceTier = typeof p.binding?.recovery?.data?.serviceTier === 'string' ? p.binding.recovery.data.serviceTier : null;
    let hostTools=p.hostTools??[];
    let threadId;
    let nativeModel = model;
    if (action === 'resume') {
      const recovery = p.binding?.recovery;
      if (p.binding?.pluginId !== pluginId || recovery?.schema !== 'dev.aibo.codex.recovery' || recovery?.version !== 1 || typeof recovery.data?.threadId !== 'string') fail('invalid_recovery_data');
      threadId = recovery.data.threadId;
      hostTools=hostTools.filter(tool=>recovery.data.hostToolNames?.includes(tool.name));
      try {
        const result = await rpc('thread/resume', { threadId, approvalPolicy, ...(approvalsReviewer ? {approvalsReviewer} : {}), sandbox, ...(model ? {model} : {}) });
        validateThreadPolicy(result, approvalPolicy, approvalsReviewer, sandbox, model);
        threadId = result?.thread?.id ?? threadId;
        nativeModel = result.model;
      } catch (error) {
        // Codex creates the thread record before its first rollout. If Aibo
        // restarts before the first turn, thread/resume cannot load that
        // record and returns "no rollout found". Recreate the logical thread
        // with the current profile; the host persists the new binding from
        // this session response, while the selected model/reasoning values
        // remain in the recovery payload below.
        if (!isMissingRolloutError(error)) throw error;
        ({threadId, model:nativeModel} = await startThread(p.workspace.path, approvalPolicy, approvalsReviewer, sandbox, model, hostTools));
      }
    } else {
      ({threadId, model:nativeModel} = await startThread(p.workspace.path, approvalPolicy, approvalsReviewer, sandbox, model, hostTools));
    }
    session = { id: p.sessionId, threadId, eventSessionId:p.eventSessionId, cwd: p.workspace.path,
      model:nativeModel, reasoningEffort, serviceTier, contextWindow, executionProfile:p.executionProfile,hostTools,
      revision: 0, turn: null, goal: null, tokenUsage: null, rateLimitUsage: null };
    if (!p.suppressStarted) emit('session.started', { state: 'idle' });
    void refreshRateLimits();
    return { nativeSessionId: threadId, recovery: recovery() };
  }
  if (!session || p.sessionId !== session.id) fail('invalid_session');
  if (action === 'send') {
    if (session.turn || session.changingContext) fail('busy');
    const turn = newTurn(p);
    session.turn = turn;
    const turnParams = { threadId: session.threadId, input: [{ type: 'text', text: p.input.text }, ...(p.input.attachments ?? []).filter(item => item.type === 'image').map(item => ({type:'localImage',path:item.path}))], summary: 'auto' };
    if (session.model) turnParams.model = session.model;
    if (session.reasoningEffort) turnParams.reasoningEffort = session.reasoningEffort;
    if (session.serviceTier) turnParams.serviceTier = session.serviceTier;
    const result = await rpc('turn/start', turnParams);
    if (session.turn === turn && turn.nativeSequence === 0) turn.nativeId = result?.turn?.id ?? turn.nativeId;
    return { accepted: true };
  }
  if (action === 'resumeGoal') {
    if (session.turn || session.changingContext) fail('busy');
    const turn = newTurn(p);
    session.turn = turn;
    const starting = (async () => {
      const goal = await readGoal();
      if (!goal || !['active','paused','blocked','usageLimited'].includes(goal.status)) fail('invalid_request','Goal cannot be resumed; a completed or budget-limited goal requires an explicit goal update');
      const revision = session.goalRevision;
      const result = await rpc('thread/goal/set', {threadId:session.threadId,status:'active'}, 10000);
      if (session.goalRevision === revision) updateGoal(result?.goal ?? null);
      if (session.turn === turn && !turn.nativeId) {
        if (session.goal?.status !== 'active') finishTurn(turn,'completed');
        else waitForGoalTurn(turn);
      }
    })();
    session.goalStarting = starting;
    try { await starting; return {accepted:true}; }
    catch (error) { clearTimeout(turn.timer); if (session.turn === turn) session.turn = null; throw error; }
    finally { if (session.goalStarting === starting) session.goalStarting = null; }
  }
  if (action === 'cancel') {
    if (session.turn?.id === p.turnId) {
      await Promise.all([...subagents.values()].filter(agent => activeSubagent(agent) && agent.nativeTurnId).map(agent => rpc('turn/interrupt', {threadId:agent.id,turnId:agent.nativeTurnId}, 5000)));
      if (session.turn && !session.turn.nativeId) finishTurn(session.turn, 'interrupted');
    }
    if (session.turn && session.turn.id === p.turnId && session.turn.nativeId) await rpc('turn/interrupt', { threadId: session.threadId, turnId: session.turn.nativeId });
    return { accepted: true };
  }
  if (action === 'operation' && ['ext.dev.aibo.codex.snapshot','ext.dev.aibo.codex.fork'].includes(p.operationId)) {
    if (session.turn) fail('busy', 'Thread must be idle');
    const isSnapshot = p.operationId.endsWith('.snapshot');
    const result = await rpc('thread/read', {threadId:session.threadId,includeTurns:!isSnapshot});
    const thread = result?.thread;
    if (thread?.id !== session.threadId || (!isSnapshot && !Array.isArray(thread.turns))) fail('invalid_output', 'Thread identity or turns missing');
    if (p.operationId.endsWith('.snapshot')) {
      const text = (...values) => values.find(value=>typeof value==='string') ?? null;
      return {thread:{id:thread.id,title:text(thread.title,thread.name,thread.preview),cwd:text(thread.cwd,thread.path),
        status:text(thread.status,thread.status?.type,thread.status?.state,thread.status?.status),
        updatedAt:text(thread.updatedAt,thread.updated_at,thread.lastUpdatedAt),turnCount:Array.isArray(thread.turns)?thread.turns.length:null}};
    }
    const nativeTurnId = p.input.nativeTurnId;
    if (nativeTurnId && !thread.turns.some(turn=>turn.id===nativeTurnId)) fail('invalid_input', 'Fork boundary is not in this native thread');
    const forked = (await rpc('thread/fork', {threadId:session.threadId,...(nativeTurnId ? {lastTurnId:nativeTurnId} : {})}))?.thread;
    if (typeof forked?.id !== 'string' || !forked.id || forked.id===session.threadId || (forked.parentThreadId && forked.parentThreadId!==session.threadId)) fail('invalid_output','Invalid fork identity');
    const binding = recovery(); binding.data.threadId = forked.id;
    return {fork:{nativeSessionId:forked.id,recovery:binding}};
  }
  if (action === 'operation' && p.operationId === 'ext.dev.aibo.codex.queue') {
    if (p.input?.action !== 'steer' || typeof p.input.message !== 'string' || !p.input.message.trim()) fail('invalid_request', 'steer message required');
    const turn = session.turn;
    if (!turn?.nativeId) fail('no_active_turn', 'no_active_turn');
    try {
      const result = await rpc('turn/steer', {threadId:session.threadId, expectedTurnId:turn.nativeId, input:[{type:'text',text:p.input.message},...(p.input.attachments??[]).filter(item=>item.type==='image').map(item=>({type:'localImage',path:item.path}))]});
      return {accepted:true,turnId:result.turnId};
    } catch (error) {
      if (error.nativeRejected) {
        if (!session.turn?.nativeId || /no active turn|no turn in progress|expectedTurnId|turn.*mismatch/i.test(error.message)) fail('no_active_turn', `no_active_turn: ${error.message}`);
        fail('steer_rejected', `steer_rejected: ${error.message}`);
      }
      throw error;
    }
  }
  if (action === 'operation' && p.operationId === 'ext.dev.aibo.codex.goal') {
    let goal;
    if (p.input?.action === 'get') return {goal:await readGoal()};
    else if (p.input?.action === 'pause') goal = await pauseGoal();
    else if (p.input?.action === 'clear') goal = await rpc('thread/goal/clear', { threadId: session.threadId });
    else if (p.input?.action === 'set') {
      if (typeof p.input.objective !== 'string' || !p.input.objective.trim()) fail('invalid_request', 'objective is required when setting a goal');
      goal = await rpc('thread/goal/set', { threadId: session.threadId, objective: p.input.objective, status:'paused', ...(p.input.tokenBudget !== undefined ? {tokenBudget:p.input.tokenBudget} : {}) });
    } else fail('invalid_request', 'unknown goal action');
    const normalized = goal && Object.prototype.hasOwnProperty.call(goal, 'goal') ? goal.goal : goal ?? null;
    updateGoal(normalized);
    return { goal: normalized };
  }
  if (action === 'operation' && p.operationId === 'ext.dev.aibo.codex.context-window') {
    if (p.input?.action === 'list') return modelCatalog();
    if (p.input?.action === 'set') return switchContextWindow(p.input.contextWindow);
    fail('invalid_request', 'unknown context window action');
  }
  if (action === 'operation' && p.operationId === 'ext.dev.aibo.codex.model') {
    if (p.input?.action === 'set') {
      if (typeof p.input.reference !== 'string' || !p.input.reference.trim()) fail('invalid_request', 'reference is required when selecting a model');
      if (session.turn || session.changingContext) fail('busy');
      if (session.contextWindow && p.input.reference !== session.model) return switchContextWindow(null, p.input.reference);
      session.model = p.input.reference;
    } else if (p.input?.action !== 'list') fail('invalid_request', 'unknown model action');
    const result = await nativeModels();
    if (p.input?.action === 'set' && session.serviceTier && session.serviceTier !== 'default') {
      const selected = (result?.data ?? []).find((item) => item.model === session.model || item.id === session.model);
      if (!selected?.serviceTiers?.some((tier) => tier?.id === session.serviceTier)) session.serviceTier = 'default';
    }
    if (p.input?.action === 'set') publishRecovery();
    return modelCatalog();
  }
  if (action === 'operation' && p.operationId === 'ext.dev.aibo.codex.service-tier') {
    if (p.input?.action === 'set') {
      if (typeof p.input.tier !== 'string' || !p.input.tier.trim()) fail('invalid_request', 'tier is required when selecting a service tier');
      const result = await nativeModels();
      const model = (result?.data ?? []).find((item) => item.model === session.model || item.id === session.model) ?? (result?.data ?? []).find((item) => item.isDefault) ?? null;
      const supported = p.input.tier === 'default' || model?.serviceTiers?.some((tier) => tier?.id === p.input.tier);
      if (!supported) fail('invalid_request', 'service tier is not supported by the current model');
      session.serviceTier = p.input.tier;
      publishRecovery();
    } else if (p.input?.action !== 'list') fail('invalid_request', 'unknown service tier action');
    return { current: session.serviceTier };
  }
  if (action === 'operation' && p.operationId === 'ext.dev.aibo.codex.reasoning') {
    if (p.input?.action === 'set') {
      if (typeof p.input.level !== 'string' || !p.input.level.trim()) fail('invalid_request', 'level is required when selecting reasoning effort');
      session.reasoningEffort = p.input.level;
      publishRecovery();
    } else if (p.input?.action !== 'list') fail('invalid_request', 'unknown reasoning action');
    const result = await nativeModels();
    const model = (result?.data ?? []).find((item) => item.model === session.model || item.id === session.model) ?? (result?.data ?? []).find((item) => item.isDefault) ?? null;
    return { current: session.reasoningEffort, levels: model?.supportedReasoningEfforts ?? [] };
  }
  if (action === 'operation' && p.operationId === 'ext.dev.aibo.codex.skills') {
    const result = await rpc('skills/list', { cwds: [session.cwd], forceReload: false });
    const skills = (result?.data ?? []).flatMap((item) => item?.skills ?? []).map((skill) => ({
      ...skill,
      description: skill.description ?? skill.interface?.shortDescription ?? null,
      insertionText: `$${skill.name} `,
      source: 'skill',
      category: 'skill',
      execution: 'prompt',
    }));
    return { skills };
  }
  if (action === 'operation' && (p.operationId === 'ext.dev.aibo.codex.approval' || p.operationId === 'ext.dev.aibo.codex.user-input')) {
    const request = providerRequests.get(p.input?.requestId);
    const expected = p.operationId.endsWith('.approval') ? 'approval' : 'user-input';
    if (!request || request.kind !== expected) fail('invalid_request', 'request is no longer pending');
    const result = expected === 'approval'
      ? request.permissions
        ? { permissions: p.input.decision === 'accept' ? request.permissions : {}, scope: 'turn' }
        : { decision: p.input.decision }
      : { answers: Object.fromEntries(Object.entries(p.input.answers).map(([key, values]) => [key, { answers: Array.isArray(values) ? values : [values] }])) };
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.rawId, result })}\n`);
    providerRequests.delete(p.input.requestId);
    emit(expected === 'approval' ? 'approval.resolved' : 'user_input.resolved', { requestId: p.input.requestId }, session.turn?.id ?? null, { requestId: p.input.requestId });
    return { resolved: true };
  }
  if (action === 'close') { await stopCodex(); session = null; return { accepted: true }; }
  fail('capability_unsupported');
}

export const stop = stopCodex;
export const snapshot = () => session ? recovery() : null;


export async function listThreads(request, {signal}) {
  if (request.scope.kind!=='workspace' || !request.context.workspacePath || !request.context.permissions.includes('workspace.read')) fail('permission_denied','Workspace read scope required');
  const abort = ()=>void stopCodex();
  signal.addEventListener('abort',abort,{once:true});
  try {
    if (signal.aborted) fail('cancelled');
    await startCodex(request.context.workspacePath);
    const result = await rpc('thread/list',{limit:100,cwd:request.context.workspacePath,sortKey:'updated_at',sortDirection:'desc'});
    if (!Array.isArray(result?.data)) fail('invalid_output','Thread catalog is missing');
    const text = (...values)=>values.find(value=>typeof value==='string') ?? null;
    return {threads:result.data.map(thread=>({id:thread.id,title:text(thread.title,thread.name,thread.preview),
      cwd:text(thread.cwd,thread.path),status:text(thread.status,thread.status?.type,thread.status?.state,thread.status?.status),
      updatedAt:text(thread.updatedAt,thread.updated_at,thread.lastUpdatedAt)}))};
  } finally {signal.removeEventListener('abort',abort);await stopCodex();}
}
