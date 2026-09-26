import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const sdkModule = await import(process.env.AIBO_PI_SDK_MODULE
  ? pathToFileURL(process.env.AIBO_PI_SDK_MODULE).href
  : '@earendil-works/pi-coding-agent');
const {
  createAgentSession,
  createBashToolDefinition,
  createFindToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  ModelRuntime,
  SessionManager,
} = sdkModule;


export const capabilities = ['session.create', 'session.resume', 'session.close', 'session.reload', 'turn.send', 'image.input', 'turn.cancel', 'stream.text', 'model.select', 'model.reasoning', 'model.context-window', 'command.list', 'skill.list', 'approval.respond', 'queue.manage', 'compaction.run', 'session.tree', 'session.timeline', 'ext.dev.aibo.pi.usage', 'ext.dev.aibo.pi.retry', 'ext.dev.aibo.pi.extension'];
let provider = null;
let session = null;
let publish;
let hostTool;
let hostHistoryTool;
let registeredHostTools=[];
export function hostToolsRegistered() { return registeredHostTools.length>0 && !!session; }
export function configure(callbacks) { publish = callbacks.emit; hostTool = callbacks.requestTool; hostHistoryTool=callbacks.requestHostTool; }
const fail = (kind, message = kind) => { throw Object.assign(new Error(message), { kind }); };
function requestCoreTool(tool, input) { return hostTool(tool, input); }
const emit = (type, payload, turnId = null, correlation = null) => publish({
  nativeSessionId: session.nativeId, turnId, type, correlation, payload,
});

function sdkMessageText(message) {
  return (Array.isArray(message?.content) ? message.content : [])
    .filter((part) => part?.type === 'text')
    .map((part) => part.text ?? '')
    .join('')
    .replace(/<think(?:ing)?(?:\s[^>]*)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
    .replace(/<\|(?:thinking|reasoning)\|>[\s\S]*?<\|end_(?:thinking|reasoning)\|>/gi, '');
}
function sdkSafeValue(value, depth = 0, seen = new WeakSet()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
    return typeof value === 'string' ? value.slice(0, 100_000) : value;
  }
  if (depth >= 8 || typeof value !== 'object') return undefined;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sdkSafeValue(item, depth + 1, seen));
  return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, item]) => [key.slice(0, 200), sdkSafeValue(item, depth + 1, seen)]));
}
function sdkMessageSummary(message) {
  const text = sdkMessageText(message).trim();
  if (text) return text;
  const content = Array.isArray(message?.content) ? message.content : [];
  const toolNames = content.filter((part) => ['toolcall', 'tool_call', 'tooluse', 'tool_use'].includes(String(part?.type ?? '').toLowerCase()))
    .map((part) => part.name ?? part.toolName ?? part.tool_name)
    .filter((name) => typeof name === 'string' && name.trim()).slice(0, 3);
  if (toolNames.length > 0) return `调用工具：${toolNames.join('、')}`;
  const hasThinking = content.some((part) => ['thinking', 'reasoning', 'redacted_thinking'].includes(String(part?.type ?? '').toLowerCase())
    || typeof part?.thinking === 'string' || typeof part?.reasoning === 'string' || typeof part?.reasoningContent === 'string' || typeof part?.reasoning_content === 'string');
  if (hasThinking) return 'Agent 思考内容（正文未显示）';
  if (message?.role === 'assistant') return 'Agent 回复（无可显示正文）';
  if (message?.role === 'user') return '用户消息（无可显示正文）';
  if (message?.role === 'toolResult' || message?.role === 'tool') return '工具结果（无可显示正文）';
  return '消息（无可显示正文）';
}
function sdkTreeSummary(entry) {
  if (entry?.type === 'message') return sdkMessageSummary(entry.message).slice(0, 500);
  if (typeof entry?.summary === 'string') return entry.summary.slice(0, 500);
  if (entry?.type === 'model_change') return `${entry.provider ?? ''}/${entry.modelId ?? ''}`;
  if (entry?.type === 'thinking_level_change') return `推理强度已切换为 ${entry.thinkingLevel ?? 'unknown'}`;
  if (entry?.type === 'session_info') return entry.name ?? '';
  return undefined;
}
function sdkCompactionResult(result) {
  if (!result || typeof result !== 'object') return null;
  return { summary: result.summary ?? null, firstKeptEntryId: result.firstKeptEntryId ?? null,
    tokensBefore: result.tokensBefore ?? null, estimatedTokensAfter: result.estimatedTokensAfter ?? null,
    usage: result.usage ?? null, details: result.details ?? null };
}
function sdkTreeNode(node, ancestors = new Set(), budget = { remaining: 4096 }) {
  const entry = node?.entry ?? {};
  const id = typeof entry.id === 'string' ? entry.id : null;
  const nextAncestors = new Set(ancestors);
  if (id) nextAncestors.add(id);
  const output = { id: entry.id, parentId: entry.parentId ?? null, type: entry.type, timestamp: entry.timestamp,
    role: entry.message?.role, summary: sdkTreeSummary(entry), label: typeof node?.label === 'string' ? node.label : undefined, children: [] };
  if (budget.remaining <= 0 || !Array.isArray(node?.children) || !id || ancestors.has(id)) return output;
  budget.remaining -= 1;
  output.children = node.children.map((child) => sdkTreeNode(child, nextAncestors, budget));
  return output;
}
function sdkTree(startedProvider) {
  const tree = startedProvider.manager.getTree?.() ?? [];
  return Array.isArray(tree) ? tree.map((node) => sdkTreeNode(node)) : [];
}
function sdkEntry(entry) {
  if (!entry || typeof entry !== 'object') return undefined;
  return { id: entry.id, parentId: entry.parentId ?? null, type: entry.type, timestamp: entry.timestamp,
    role: entry.message?.role, toolName: entry.message?.toolName, stopReason: entry.message?.stopReason,
    // Branch snapshots feed the timeline; only tree node labels are truncated.
    isError: entry.message?.isError,
    parts: entry.message?.role === 'assistant' ? sdkAssistantParts(entry.message) : undefined,
    summary: entry.type === 'message'
      ? sdkMessageSummary(entry.message)
      : typeof entry.summary === 'string' ? entry.summary : sdkTreeSummary(entry) };
}
function sdkAssistantParts(message) {
  return (Array.isArray(message?.content) ? message.content : []).flatMap((part, index) => {
    const type = String(part?.type ?? '').toLowerCase();
    if (type === 'text') {
      const text = sdkMessageText({ content: [part] });
      return text.trim() ? [{ index, role: 'assistant', type: 'message', summary: text }] : [];
    }
    if (['thinking', 'reasoning', 'redacted_thinking'].includes(type)) {
      return [{ index, role: 'system', type: 'reasoning', toolName: 'reasoning',
        summary: 'Agent 思考内容（正文未显示）' }];
    }
    if (['toolcall', 'tool_call', 'tooluse', 'tool_use'].includes(type)) {
      return [{ index, role: 'tool', type: 'tool_call', toolName: part.name ?? part.toolName ?? part.tool_name ?? 'tool',
        summary: JSON.stringify(sdkSafeValue(part.arguments ?? part.args ?? part.input ?? {}), null, 2) }];
    }
    return [];
  });
}
function sdkExtensionEntry(entry) {
  if (!entry || typeof entry !== 'object') return undefined;
  return { ...sdkEntry(entry), customType: entry.customType, display: sdkSafeValue(entry.display), data: sdkSafeValue(entry.data) };
}
function sdkBranch(startedProvider) {
  const entries = startedProvider.manager.getEntries?.() ?? [];
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const branch = [];
  const seen = new Set();
  let currentId = startedProvider.manager.getLeafId?.() ?? null;
  while (currentId && !seen.has(currentId) && branch.length < 4096) {
    seen.add(currentId);
    const entry = byId.get(currentId);
    if (!entry) break;
    branch.push(sdkExtensionEntry(entry));
    currentId = typeof entry.parentId === 'string' ? entry.parentId : null;
  }
  return branch.reverse();
}
function sdkCommands(sdkSession) {
  return [
    { name: 'compact', description: '压缩当前会话上下文', source: 'builtin', category: 'agent', execution: 'adapter' },
    { name: 'model', description: '查看或切换当前模型', source: 'builtin', category: 'agent', execution: 'adapter' },
    { name: 'thinking', description: '查看或设置推理强度', source: 'builtin', category: 'agent', execution: 'adapter' },
    { name: 'reload', description: '重新加载会话资源', source: 'builtin', category: 'agent', execution: 'adapter' },
    ...(sdkSession.extensionRunner?.getRegisteredCommands?.() ?? []).map((command) => ({
      name: command.invocationName, description: command.description ?? null, source: 'extension', category: 'extension', execution: 'prompt',
    })),
    ...(sdkSession.promptTemplates ?? []).map((template) => ({ name: template.name, description: template.description ?? null, source: 'prompt', category: 'extension', execution: 'prompt' })),
    ...(sdkSession.resourceLoader?.getSkills?.().skills ?? []).map((skill) => ({ name: `skill:${skill.name}`, description: skill.description ?? null, source: 'skill', category: 'skill', execution: 'prompt' })),
  ];
}
function sdkSkills(sdkSession) {
  return (sdkSession.resourceLoader?.getSkills?.().skills ?? []).map((skill) => ({
    name: skill.name,
    description: skill.description ?? null,
    source: skill.source ?? null,
    filePath: skill.filePath ?? null,
  }));
}
async function corePath(path, action = 'access') {
  const result = await requestCoreTool('read_file', { path, action });
  return result.path ?? path;
}
function coreReadOperations() {
  return {
    readFile: async (absolutePath) => {
      const result = await requestCoreTool('read_file', { path: absolutePath, action: 'read' });
      if (result.encoding === 'base64' && typeof result.data === 'string') return Buffer.from(result.data, 'base64');
      if (typeof result.content === 'string') return Buffer.from(result.content, 'utf8');
      throw new Error('Core returned an unreadable file');
    },
    access: async (absolutePath) => { await corePath(absolutePath, 'access'); },
    detectImageMimeType: async (absolutePath) => {
      const result = await requestCoreTool('read_file', { path: absolutePath, action: 'image_mime' });
      return typeof result.mimeType === 'string' ? result.mimeType : null;
    },
  };
}
function createCoreGrepTool() {
  return {
    name: 'grep',
    label: 'grep',
    description: 'Search workspace file contents for a pattern. Results are mediated by Aibo Core.',
    promptSnippet: 'Search file contents for patterns (respects .gitignore)',
    parameters: { type: 'object', additionalProperties: false, required: ['pattern'], properties: {
      pattern: { type: 'string' }, path: { type: 'string' }, glob: { type: 'string' },
      ignoreCase: { type: 'boolean' }, literal: { type: 'boolean' }, context: { type: 'number' }, limit: { type: 'number' },
    } },
    async execute(_toolCallId, input) {
      const result = await requestCoreTool('read_file', { action: 'grep', ...input, path: input.path ?? process.cwd() });
      return { content: [{ type: 'text', text: typeof result.content === 'string' ? result.content : 'No matches found' }] };
    },
  };
}
function coreFindOperations() {
  return {
    exists: async (absolutePath) => Boolean((await requestCoreTool('read_file', { path: absolutePath, action: 'exists' })).exists),
    glob: async (pattern, cwd, options) => {
      const result = await requestCoreTool('read_file', { path: cwd, action: 'glob', pattern, limit: options.limit });
      return Array.isArray(result.paths) ? result.paths : [];
    },
  };
}
function coreLsOperations() {
  return {
    exists: async (absolutePath) => Boolean((await requestCoreTool('read_file', { path: absolutePath, action: 'exists' })).exists),
    stat: async (absolutePath) => {
      const result = await requestCoreTool('read_file', { path: absolutePath, action: 'is_directory' });
      return { isDirectory: () => Boolean(result.isDirectory) };
    },
    readdir: async (absolutePath) => {
      const result = await requestCoreTool('read_file', { path: absolutePath, action: 'list' });
      return Array.isArray(result.entries) ? result.entries : [];
    },
  };
}
// pi-coding-agent 0.84.4 docs/models.md explicitly documents this opt-in.
// These are direct OpenAI Responses limits, NOT Codex subscription limits.
function sdkContextOptions(model) {
  if (!model || model.provider !== 'openai' || model.api !== 'openai-responses'
    || model.baseUrl !== 'https://api.openai.com/v1'
    || !['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'].includes(model.id)
    || ![272000, 1050000].includes(model.contextWindow)) return [];
  return [272000, 1050000].map(tokens => ({id:String(tokens),tokens,
    label:tokens === 272000 ? '272K' : '1.05M',
    description:tokens === 272000 ? 'Pi SDK 默认窗口' : 'OpenAI 官方长上下文窗口（可能使用长上下文计费）'}));
}
async function sdkVerifiedContextOptions(startedProvider, model) {
  const options = sdkContextOptions(model);
  if (!options.length) return [];
  try {
    const auth = await startedProvider.modelRuntime.getAuth(model);
    if (!auth || (auth.auth?.baseUrl && auth.auth.baseUrl !== 'https://api.openai.com/v1')) return [];
    return options;
  } catch { return []; }
}
async function sdkSetContext(startedProvider, id) {
  const sdkSession = startedProvider.sdkSession;
  const before = sdkSession.model;
  const base = before && startedProvider.modelRuntime.getModel(before.provider, before.id);
  const option = (await sdkVerifiedContextOptions(startedProvider, base)).find(option => option.id === id);
  if (!option) fail('invalid_request', 'Context window is not supported by this provider/model');
  if (before.contextWindow === option.tokens) return id;
  const thinking = sdkSession.thinkingLevel;
  try {
    await sdkSession.setModel({...base, contextWindow:option.tokens});
    if (sdkSession.model?.id !== base.id || sdkSession.model?.provider !== base.provider || sdkSession.model?.contextWindow !== option.tokens) fail('invalid_output', 'Pi did not apply the context window');
    sdkSession.setThinkingLevel(thinking);
  } catch (error) {
    await sdkSession.setModel(before);
    sdkSession.setThinkingLevel(thinking);
    throw error;
  }
  return id;
}
function sdkModelDescriptor(model, contextWindows = []) {
  return { provider: model.provider, id: model.id, name: model.name ?? null, reasoning: model.reasoning === true,
    thinkingLevelMap: model.thinkingLevelMap ?? null, contextWindows };
}
function sdkEvent(message) {
  const type = message?.type;
  if (type === 'message_start' || type === 'message_end') return { type, message: message.message };
  if (type === 'message_update') return { type, message: message.message, assistantMessageEvent: message.assistantMessageEvent, usage: message.usage };
  if (type === 'agent_start') return { type };
  if (type === 'agent_end') return { type, messages: message.messages, willRetry: message.willRetry };
  if (type === 'agent_error') return { type: 'agent_end', messages: [{ role: 'assistant', content: [], stopReason: 'error' }], error: message.error ?? message.message };
  if (type === 'queue_update' || type === 'compaction_start' || type === 'compaction_end' || type === 'auto_retry_start' || type === 'auto_retry_end' || type?.startsWith('summarization_retry_')) return message;
  if (type === 'session_info_changed' || type === 'thinking_level_changed') return message;
  if (type === 'entry_appended') return message;
  if (type?.startsWith('tool_execution_')) {
    return { type, toolCallId: message.toolCallId ?? message.id, toolName: message.toolName ?? message.name,
      args: message.args, result: message.result, isError: message.isError };
  }
  return null;
}
async function sdkRequest(startedProvider, type, fields) {
  const sdkSession = startedProvider.sdkSession;
  if (type === 'get_state') {
    const currentModel = sdkSession.model
      && startedProvider.modelRuntime.getModel(sdkSession.model.provider, sdkSession.model.id)
      ? { provider: sdkSession.model.provider, modelId: sdkSession.model.id }
      : null;
    return { success: true, data: {
      sessionId: sdkSession.sessionId,
      sessionFile: sdkSession.sessionFile ?? startedProvider.manager.getSessionFile?.() ?? null,
      model: currentModel,
      thinkingLevel: sdkSession.thinkingLevel ?? null,
    } };
  }
  if (type === 'prompt' && session?.contextWindow) {
    const model = sdkSession.model;
    if (model?.provider !== session.model?.provider || model?.id !== session.model?.modelId) session.contextWindow = null;
    else await sdkSetContext(startedProvider, session.contextWindow);
  }
  if (type === 'prompt') {
    void sdkSession.prompt(String(fields.message ?? ''), { images: fields.images }).catch((error) => {
      onPi(sdkEvent({ type: 'agent_error', error: error.message }), startedProvider);
      onPi({ type: 'agent_settled' }, startedProvider);
    });
    return { success: true };
  }
  if (type === 'abort') return { success: true, data: await sdkSession.abort() };
  if (type === 'get_available_models') {
    const currentOptions = await sdkVerifiedContextOptions(startedProvider, sdkSession.model);
    return {success:true, data:{
      models:await Promise.all(startedProvider.modelRuntime.getAvailableSnapshot().map(async model =>
        sdkModelDescriptor(model, await sdkVerifiedContextOptions(startedProvider, model)))),
      current:sdkSession.model ? sdkModelDescriptor(sdkSession.model, currentOptions) : null,
      currentContextWindow:currentOptions.find(option => option.tokens === sdkSession.model?.contextWindow)?.id ?? null,
    }};
  }
  if (type === 'set_model') {
    const model = startedProvider.modelRuntime.getModel(fields.provider, fields.modelId);
    if (!model) throw new Error(`Model not found: ${fields.provider}/${fields.modelId}`);
    await sdkSession.setModel(model);
    return { success: true, data: sdkModelDescriptor(model) };
  }
  if (type === 'get_available_thinking_levels') return { success: true, data: {
    levels: sdkSession.getAvailableThinkingLevels(),
    current: sdkSession.thinkingLevel ?? null,
  } };
  if (type === 'set_thinking_level') { sdkSession.setThinkingLevel(fields.level); return { success: true, data: { level: sdkSession.thinkingLevel } }; }
  if (type === 'get_commands') return { success: true, data: { commands: sdkCommands(sdkSession) } };
  if (type === 'get_skills') return { success: true, data: { skills: sdkSkills(sdkSession) } };
  if (type === 'steer' && (!session?.turn || !sdkSession.isStreaming)) fail('no_active_turn', 'no_active_turn');
  if (type === 'steer' || type === 'follow_up') { await sdkSession[type === 'steer' ? 'steer' : 'followUp'](fields.message, fields.images); return { success: true, data: { queued: fields.message } }; }
  if (type === 'clear_queue') { const queue = sdkSession.clearQueue(); return { success: true, data: queue }; }
  if (type === 'compact') return { success: true, data: { ...(await sdkSession.compact(fields.customInstructions || undefined)) } };
  if (type === 'get_tree') return { success: true, data: { tree: sdkTree(startedProvider), leafId: startedProvider.manager.getLeafId(), branch: sdkBranch(startedProvider) } };
  if (type === 'navigate_tree') {
    const result = await sdkSession.navigateTree(fields.entryId, { summarize: fields.summarize === true,
      customInstructions: fields.customInstructions || undefined, replaceInstructions: fields.replaceInstructions === true });
    return { success: true, data: { ...result, tree: sdkTree(startedProvider), leafId: startedProvider.manager.getLeafId() } };
  }
  if (type === 'reload') { await sdkSession.reload(); if (session?.contextWindow) await sdkSetContext(startedProvider, session.contextWindow); return { success: true, data: { commands: sdkCommands(sdkSession) } }; }
  throw new Error(`Unknown Pi SDK request: ${type}`);
}
function dispatch(type, fields = {}) {
  const startedProvider = provider;
  if (!startedProvider) return Promise.reject(new Error('Pi unavailable'));
  return sdkRequest(startedProvider, type, fields);
}
function visibleText(message) {
  if (!message || message.role !== 'assistant' || !Array.isArray(message.content)) return '';
  return message.content.filter((part) => part?.type === 'text').map((part) => part.text ?? '').join('');
}
function nativeMessageId(message) {
  for (const key of ['id', 'messageId', 'itemId']) {
    if (typeof message?.[key] === 'string' && message[key]) return message[key];
  }
  return null;
}
function newTurnItem(turn, message = null) {
  const nativeId = nativeMessageId(message);
  const itemId = nativeId ?? `assistant-${turn.nextItemNumber++}`;
  const item = { itemId, text: '', completed: false };
  turn.items.set(itemId, item);
  turn.itemOrder.push(item);
  turn.currentItem = item;
  if (message && typeof message === 'object') turn.messageObjects.set(message, item);
  if (nativeId) turn.nativeItems.set(nativeId, item);
  return item;
}
function itemForMessage(turn, message = null) {
  if (message && typeof message === 'object') {
    const objectItem = turn.messageObjects.get(message);
    if (objectItem) return objectItem;
  }
  const nativeId = nativeMessageId(message);
  if (nativeId && turn.nativeItems.has(nativeId)) return turn.nativeItems.get(nativeId);
  if (turn.currentItem && !turn.currentItem.completed) {
    if (message && typeof message === 'object') turn.messageObjects.set(message, turn.currentItem);
    if (nativeId) turn.nativeItems.set(nativeId, turn.currentItem);
    return turn.currentItem;
  }
  return newTurnItem(turn, message);
}
function rememberAgentMessages(turn, messages) {
  turn.agentMessages = Array.isArray(messages) ? messages : [];
  let order = 0;
  for (const message of turn.agentMessages) {
    const text = visibleText(message);
    if (!text) continue;
    const nativeId = nativeMessageId(message);
    const item = (message && typeof message === 'object' && turn.messageObjects.get(message))
      ?? (nativeId && turn.nativeItems.get(nativeId))
      ?? turn.itemOrder[order]
      ?? newTurnItem(turn, message);
    if (!item) continue;
    if (message && typeof message === 'object') turn.messageObjects.set(message, item);
    if (nativeId) turn.nativeItems.set(nativeId, item);
    if (!item.completed || !item.text) item.text = text;
    order += 1;
  }
}
function completeTurnItem(turn, item, text = '') {
  if (text) item.text = text;
  if (item.completed) return;
  item.completed = true;
  if (item.text) emit('message.completed', { itemId: item.itemId, text: item.text }, turn.id, { requestId: turn.requestId, itemId: item.itemId });
}
function recovery() {
  return { schema: 'dev.aibo.pi.recovery', version: 1, data: {
    nativeSessionId: session.nativeId,
    sessionFile: session.sessionFile,
    model: session.model,
    thinkingLevel: session.thinkingLevel,
    contextWindow: session.contextWindow,
  } };
}
async function updateRecovery(metadata = {}) {
  if (!session || !provider) return;
  try {
    const state = await dispatch('get_state');
    session.sessionFile = state.data?.sessionFile ?? session.sessionFile;
  } catch {}
  emit('session.info_changed', { ...metadata, recovery: recovery() });
}
function onPi(message, startedProvider) {
  if (provider !== startedProvider) return;
  const turn = session?.turn;
  if (message.type === 'queue_update') {
    emit('queue.updated', { steering: Array.isArray(message.steering) ? message.steering : [], followUp: Array.isArray(message.followUp) ? message.followUp : [] }, turn?.id ?? null,
      turn ? { requestId: turn.requestId, itemId: null } : null);
    return;
  }
  if (message.type === 'compaction_start') {
    emit('compaction.started', { reason: message.reason ?? null }, turn?.id ?? null,
      turn ? { requestId: turn.requestId, itemId: null } : null);
    return;
  }
  if (message.type === 'compaction_end') {
    emit('compaction.completed', { reason: message.reason ?? null, aborted: message.aborted === true,
      willRetry: message.willRetry === true, errorMessage: message.errorMessage ?? null,
      result: sdkCompactionResult(message.result), summary: message.result?.summary ?? null }, turn?.id ?? null,
      turn ? { requestId: turn.requestId, itemId: null } : null);
    return;
  }
  if (message.type === 'auto_retry_start' || message.type === 'summarization_retry_scheduled') {
    emit('retry.started', { kind: message.type === 'auto_retry_start' ? 'agent' : 'summarization', attempt: message.attempt ?? null,
      maxAttempts: message.maxAttempts ?? null, delayMs: message.delayMs ?? null, errorMessage: message.errorMessage ?? null }, turn?.id ?? null,
      turn ? { requestId: turn.requestId, itemId: null } : null);
    return;
  }
  if (message.type === 'summarization_retry_attempt_start') {
    emit('retry.started', { kind: 'summarization', phase: 'attempt_start', source: message.source ?? null, reason: message.reason ?? null }, turn?.id ?? null,
      turn ? { requestId: turn.requestId, itemId: null } : null);
    return;
  }
  if (message.type === 'auto_retry_end' || message.type === 'summarization_retry_finished') {
    emit('retry.completed', { kind: message.type === 'auto_retry_end' ? 'agent' : 'summarization', success: message.success !== false,
      attempt: message.attempt ?? null, finalError: message.finalError ?? null }, turn?.id ?? null,
      turn ? { requestId: turn.requestId, itemId: null } : null);
    return;
  }
  if (message.type === 'thinking_level_changed') {
    if (typeof message.level === 'string') session.thinkingLevel = message.level;
    return;
  }
  if (message.type === 'session_info_changed') {
    // Model changes are persisted synchronously by Core in the execution
    // profile. Only native session metadata changes need a binding update.
    if (typeof message.name === 'string') void updateRecovery({ name: message.name });
    return;
  }
  if (message.type === 'extension_update') {
    emit('extension.updated', { name: message.name ?? null, extension: message.extension ?? null, metadata: message.metadata ?? null }, turn?.id ?? null,
      turn ? { requestId: turn.requestId, itemId: null } : null);
    return;
  }
  if (message.type === 'entry_appended') {
    emit('extension.updated', { entry: sdkExtensionEntry(message.entry) }, turn?.id ?? null,
      turn ? { requestId: turn.requestId, itemId: null } : null);
    return;
  }
  if (!turn) return;
  if (message.type === 'message_start' && message.message?.role === 'assistant') {
    itemForMessage(turn, message.message);
  } else if (message.type === 'agent_start') {
    emit('turn.started', {}, turn.id, { requestId: turn.requestId, itemId: null });
  } else if (message.type === 'tool_execution_start' || message.type === 'tool_execution_update' || message.type === 'tool_execution_end') {
    const itemId = message.toolCallId ?? `tool-${turn.toolItems.size + 1}`;
    const item = turn.toolItems.get(itemId) ?? { itemId, itemType: message.toolName ?? 'tool' };
    turn.toolItems.set(itemId, item);
    const type = message.type === 'tool_execution_start' ? 'tool.started' : message.type === 'tool_execution_end' ? 'tool.completed' : 'tool.updated';
    const resultObject = message.result && typeof message.result === 'object' ? message.result : null;
    const argsObject = message.args && typeof message.args === 'object' ? message.args : null;
    const output = typeof resultObject?.output === 'string' ? resultObject.output : null;
    const result = output ?? (typeof message.result === 'string' ? message.result : message.result ? JSON.stringify(message.result) : null);
    const command = typeof argsObject?.command === 'string' ? argsObject.command
      : typeof resultObject?.command === 'string' ? resultObject.command : null;
    const cwd = typeof argsObject?.cwd === 'string' ? argsObject.cwd
      : typeof resultObject?.cwd === 'string' ? resultObject.cwd : null;
    const exitCode = typeof resultObject?.exitCode === 'number' ? resultObject.exitCode : null;
    emit(type, { itemId, itemType: item.itemType, status: message.isError ? 'failed' : type === 'tool.completed' ? 'completed' : 'inProgress',
      summary: message.toolName ?? item.itemType, delta: null, output: result, command, cwd, exitCode }, turn.id,
      { requestId: turn.requestId, itemId });
  } else if (message.type === 'message_update') {
    if (message.assistantMessageEvent?.type === 'text_delta') {
      const delta = message.assistantMessageEvent.delta ?? '';
      if (delta) {
        const item = itemForMessage(turn, message.message);
        turn.text += delta;
        item.text += delta;
        emit('message.delta', { itemId: item.itemId, delta }, turn.id, { requestId: turn.requestId, itemId: item.itemId });
      }
    }
    if (message.usage && typeof message.usage === 'object') {
      emit('usage.updated', { usage: message.usage }, turn.id, { requestId: turn.requestId, itemId: null });
    }
  } else if (message.type === 'message_end') {
    const item = itemForMessage(turn, message.message);
    if (message.message?.role === 'assistant' && !item.reasoningCompleted) {
      item.reasoningCompleted = true;
      for (const part of sdkAssistantParts(message.message).filter((part) => part.type === 'reasoning')) {
        const itemId = `${item.itemId}:reasoning:${part.index}`;
        emit('reasoning.completed', { itemId, summary: part.summary }, turn.id, { requestId: turn.requestId, itemId });
      }
    }
    const text = visibleText(message.message);
    if (text) turn.finalText = text;
    completeTurnItem(turn, item, text);
  } else if (message.type === 'agent_end') {
    const final = Array.isArray(message.messages) ? message.messages.map(visibleText).filter(Boolean).at(-1) : '';
    if (final) turn.finalText = final;
    rememberAgentMessages(turn, message.messages);
    turn.aborted = message.messages?.some((item) => item?.stopReason === 'aborted') === true;
    turn.failed = message.messages?.some((item) => item?.stopReason === 'error') === true;
    const failure = message.messages?.findLast((item) => item?.stopReason === 'error')?.errorMessage ?? message.error;
    turn.failureMessage = typeof failure === 'string' && failure.trim() ? failure.slice(0, 8000) : 'Pi turn failed';
  } else if (message.type === 'agent_settled') {
    if (turn.items.size === 0 && (turn.finalText || turn.text)) {
      const item = newTurnItem(turn);
      item.text = turn.finalText || turn.text;
    }
    for (const item of turn.itemOrder) completeTurnItem(turn, item);
    if (turn.failed) emit('turn.failed', { message: turn.failureMessage ?? 'Pi turn failed' }, turn.id, { requestId: turn.requestId, itemId: null });
    else emit('turn.completed', { status: turn.aborted ? 'interrupted' : 'completed' }, turn.id, { requestId: turn.requestId, itemId: null });
    session.turn = null;  void updateRecovery();
  }
}
async function startPi(cwd, runtimeDataPath, sessionFile, executionProfile = {}, hostTools = []) {
  const modelRuntime = await ModelRuntime.create();
  let manager;
  if (sessionFile) {
    try { manager = SessionManager.open(sessionFile, runtimeDataPath, cwd); } catch {}
  }
  manager ??= SessionManager.create(cwd, runtimeDataPath);
  const workspaceWriteEnabled = executionProfile.interactionMode === 'edit' && executionProfile.filesystemPolicy === 'workspace-write';
  const commandEnabled = executionProfile.interactionMode === 'edit' && executionProfile.commandPolicy !== 'disabled';
  const customTools = hostTools.map(tool=>({name:tool.name,label:tool.name,description:tool.description,parameters:tool.inputSchema,
    async execute(_id,input){const result=await hostHistoryTool(tool.name,input);return {content:[{type:'text',text:JSON.stringify(result)}]};}}));
  customTools.push(createReadToolDefinition(cwd, { operations: coreReadOperations() }));
  customTools.push(createCoreGrepTool());
  customTools.push(createFindToolDefinition(cwd, { operations: coreFindOperations() }));
  customTools.push(createLsToolDefinition(cwd, { operations: coreLsOperations() }));
  if (workspaceWriteEnabled) customTools.push(createWriteToolDefinition(cwd, {
    operations: {
      mkdir: async () => {},
      writeFile: (absolutePath, content) => requestCoreTool('write_file', { path: absolutePath, content }),
    },
  }));
  if (commandEnabled) customTools.push(createBashToolDefinition(cwd, {
    operations: {
      exec: async (command, commandCwd, { onData, timeout }) => {
        const result = await requestCoreTool('run_command', { command, cwd: commandCwd, timeout });
        if (typeof result?.output === 'string' && result.output) onData(Buffer.from(result.output));
        return { exitCode: typeof result?.exitCode === 'number' ? result.exitCode : null };
      },
    },
  }));
  const activeToolNames = [...hostTools.map(tool=>tool.name), 'read', 'grep', 'find', 'ls', ...(workspaceWriteEnabled ? ['write'] : []), ...(commandEnabled ? ['bash'] : [])];
  const created = await createAgentSession({ cwd, sessionManager: manager, modelRuntime, tools: activeToolNames,
    customTools: customTools.length > 0 ? customTools : undefined });
  const sdkSession = created.session;
  try {
    const requestedModel = typeof executionProfile.model === 'string' ? executionProfile.model.trim() : '';
    if (requestedModel) {
      const separator = requestedModel.indexOf('/');
      const requestedProvider = separator > 0 ? requestedModel.slice(0, separator) : null;
      const requestedModelId = separator > 0 ? requestedModel.slice(separator + 1) : requestedModel;
      const model = requestedProvider
        ? modelRuntime.getModel(requestedProvider, requestedModelId)
        : modelRuntime.getAvailableSnapshot().find((candidate) => candidate.id === requestedModelId);
      if (!model) throw new Error(`Model not found: ${requestedModel}`);
      if (sdkSession.model?.provider !== model.provider || sdkSession.model?.id !== model.id) {
        await sdkSession.setModel(model);
      }
    }
    if (typeof executionProfile.reasoningEffort === 'string' && executionProfile.reasoningEffort.trim()) {
      const requestedLevel = executionProfile.reasoningEffort.trim();
      if (!sdkSession.getAvailableThinkingLevels().includes(requestedLevel)) {
        throw new Error(`Thinking level not found: ${requestedLevel}`);
      }
      if (sdkSession.thinkingLevel !== requestedLevel) sdkSession.setThinkingLevel(requestedLevel);
    }
  } catch (error) {
    sdkSession.dispose();
    throw error;
  }
  const startedProvider = { sdkSession, manager, modelRuntime, unsubscribe: null };
  provider = startedProvider;
  startedProvider.unsubscribe = sdkSession.subscribe((event) => {
    const normalized = sdkEvent(event);
    if (normalized) {
      onPi(normalized, startedProvider);
      if (normalized.type === 'agent_end' && normalized.willRetry !== true) onPi({ type: 'agent_settled' }, startedProvider);
    }
  });
  return dispatch('get_state');
}
async function stopPi() {
  const stoppedProvider = provider;
  if (!stoppedProvider) return;
  provider = null;
  stoppedProvider.unsubscribe?.();
  stoppedProvider.sdkSession.dispose();
}
export async function execute(action, p) {
  const id = p.requestId;
  if (action === 'create' || action === 'resume') {
    if (session || !p.workspace?.path || typeof p.executionProfile?.runtimeDataPath !== 'string') fail('permission_denied');
    const previous = action === 'resume' ? p.binding?.recovery : null;
    if (previous && (previous.schema !== 'dev.aibo.pi.recovery' || previous.version !== 1)) fail('invalid_recovery_data');
    const state = await startPi(p.workspace.path, p.executionProfile.runtimeDataPath, previous?.data?.sessionFile ?? null, p.executionProfile,p.hostTools??[]);
    registeredHostTools=p.hostTools??[];
    const nativeId = state.data?.sessionId;
    if (!nativeId) fail('invalid_session', 'Pi did not return a session id');
    const configuredReference = typeof p.executionProfile.model === 'string' ? p.executionProfile.model : '';
    const separator = configuredReference.indexOf('/');
    const configuredModel = separator > 0 ? {
      provider: configuredReference.slice(0, separator), modelId: configuredReference.slice(separator + 1),
    } : null;
    const model = configuredModel ?? previous?.data?.model ?? state.data?.model;
    const thinkingLevel = typeof p.executionProfile.reasoningEffort === 'string'
      ? p.executionProfile.reasoningEffort
      : previous?.data?.thinkingLevel ?? state.data?.thinkingLevel;
    session = { id: p.sessionId, nativeId, sessionFile: state.data?.sessionFile ?? null,
      model: model && typeof model.provider === 'string' && typeof model.modelId === 'string' ? model : null,
      thinkingLevel: typeof thinkingLevel === 'string'
        ? thinkingLevel
        : null,
      contextWindow:null, revision: 0, turn: null };
    try {
      const currentModel = state.data?.model;
      if (session.model && (currentModel?.provider !== session.model.provider || currentModel?.modelId !== session.model.modelId)) {
        await dispatch('set_model', session.model);
      }
      const restoredWindow = previous?.data?.contextWindow;
      if (restoredWindow && previous.data.model?.provider === session.model?.provider && previous.data.model?.modelId === session.model?.modelId) {
        session.contextWindow = await sdkSetContext(provider, restoredWindow);
      }
      if (session.thinkingLevel && state.data?.thinkingLevel !== session.thinkingLevel) {
        await dispatch('set_thinking_level', { level: session.thinkingLevel });
      }
    } catch (error) {
      await stopPi();
      session = null;
      throw error;
    }
    emit('session.started', { state: 'idle', nativeSandbox: false });
    return { nativeSessionId: nativeId, recovery: recovery() };
  }
  if (!session || p.sessionId !== session.id) fail('invalid_session');
  if (action === 'send') {
    if (session.turn || session.changingContext) fail('busy');
    const turn = { id: p.turnId, requestId: id, text: '', finalText: '', aborted: false, failed: false,
      nextItemNumber: 1, items: new Map(), nativeItems: new Map(), messageObjects: new WeakMap(),
      itemOrder: [], currentItem: null, agentMessages: [], toolItems: new Map() };
    session.turn = turn;
    try {
      let images;
      if (p.input.attachments?.some(item => item.type === 'image')) {
        turn.loadingImages = true;
        images = await imageInputs(p.input.attachments);
        turn.loadingImages = false;
        if (session.turn !== turn) return { accepted: true };
      }
      await dispatch('prompt', { message: p.input.text, images });
    } catch (error) {
      if (session.turn === turn) { session.turn = null;  }
      throw error;
    }
    return { accepted: true };
  }
  if (action === 'cancel') {
    if (session.turn?.id === p.turnId) {
      if (session.turn.loadingImages) {
        emit('turn.completed', { status: 'interrupted' }, session.turn.id, { requestId: session.turn.requestId, itemId: null });
        session.turn = null;
        return { accepted: true };
      }
      try {
        await dispatch('abort');
      } catch (error) {
        if (session.turn?.id === p.turnId) {
          emit('turn.failed', { message: error.message }, session.turn.id, { requestId: session.turn.requestId, itemId: null });
          session.turn = null;

        }
        throw error;
      }
    }
    return { accepted: true };
  }
  if (action === 'operation') {
    let result;
    if (p.operationId === 'ext.dev.aibo.pi.context-window') {
      if (p.input?.action === 'set') {
        if (session.turn || session.changingContext) fail('busy');
        session.changingContext = true;
        try { session.contextWindow = await sdkSetContext(provider, p.input.contextWindow); await updateRecovery(); }
        finally { session.changingContext = false; }
      } else if (p.input?.action !== 'list') fail('invalid_request', 'unknown context window action');
      result = await dispatch('get_available_models');
    } else if (p.operationId === 'ext.dev.aibo.pi.model') {
      if (p.input?.action === 'list') result = await dispatch('get_available_models');
      else if (p.input?.action === 'set' && p.input.provider && p.input.modelId) {
        const requestedModel = { provider: p.input.provider, modelId: p.input.modelId };
        result = await dispatch('set_model', requestedModel);
        session.model = requestedModel;
        session.contextWindow = null;
      }
      else fail('invalid_request', 'provider and modelId are required when selecting a model');
    } else if (p.operationId === 'ext.dev.aibo.pi.reasoning') {
      if (p.input?.action === 'list') result = await dispatch('get_available_thinking_levels');
      else if (p.input?.action === 'set' && p.input.level) {
        result = await dispatch('set_thinking_level', { level: p.input.level });
        session.thinkingLevel = result.data?.level ?? p.input.level;
      }
      else fail('invalid_request', 'level is required when selecting reasoning effort');
    } else if (p.operationId === 'ext.dev.aibo.pi.commands') result = await dispatch('get_commands');
    else if (p.operationId === 'ext.dev.aibo.pi.skills') result = await dispatch('get_skills');
    else if (p.operationId === 'ext.dev.aibo.pi.reload') result = await dispatch('reload');
    else if (p.operationId === 'ext.dev.aibo.pi.queue') {
      if (p.input?.action === 'clear') result = await dispatch('clear_queue');
      else if (p.input?.action === 'steer' && p.input.message) result = await dispatch('steer', { message: p.input.message, images: await imageInputs(p.input.attachments) });
      else if (p.input?.action === 'followUp' && p.input.message) result = await dispatch('follow_up', { message: p.input.message, images: await imageInputs(p.input.attachments) });
      else fail('invalid_request', 'message is required when adding to the queue');
    } else if (p.operationId === 'ext.dev.aibo.pi.compact') {
      result = await dispatch('compact', { customInstructions: p.input?.instructions || undefined });
    }
    else if (p.operationId === 'ext.dev.aibo.pi.tree') {
      if (p.input?.action === 'get') result = await dispatch('get_tree');
      else if (p.input?.action === 'navigate' && p.input.entryId) result = await dispatch('navigate_tree', {
        entryId: p.input.entryId, summarize: p.input.summarize === true,
        customInstructions: p.input.customInstructions ?? null, replaceInstructions: false,
      });
      else fail('invalid_request', 'tree action and entryId are required');
    }
    else if (p.operationId === 'ext.dev.aibo.pi.snapshot') {
      result = await dispatch('get_tree');
    }
    else fail('capability_unsupported');
    return result?.data ?? {};
  }
  if (action === 'close') { await stopPi(); session = null; return { accepted: true }; }
  fail('capability_unsupported');
}
export const stop = stopPi;
export const snapshot = () => session ? recovery() : null;

async function imageInputs(attachments = []) {
  return Promise.all(attachments.filter(item => item.type === 'image').map(async item => ({ type:'image', mimeType:item.mimeType, data:(await readFile(item.path)).toString('base64') })));
}
