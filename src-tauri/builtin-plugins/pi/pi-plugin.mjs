import { spawn, spawnSync } from 'node:child_process';
import readline from 'node:readline';
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

const pluginId = 'dev.aibo.pi';
const pluginVersion = '1.0.0';
const agentId = 'dev.aibo.pi.agent';
const capabilities = ['session.create', 'session.resume', 'session.close', 'session.reload', 'turn.send', 'turn.cancel', 'stream.text', 'view.standard', 'model.select', 'model.reasoning', 'command.list', 'skill.list', 'approval.respond', 'queue.manage', 'compaction.run', 'session.tree', 'session.snapshot', 'ext.dev.aibo.pi.usage', 'ext.dev.aibo.pi.retry', 'ext.dev.aibo.pi.extension'];
let initialized = false;
let workspaceRoots = [];
let provider = null;
let nextId = 1;
let session = null;
let nextCoreToolRequestId = 1;
const pendingCoreToolRequests = new Map();

const write = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
const respond = (id, result) => write({ id, result });
const fail = (kind, message = kind) => { throw Object.assign(new Error(message), { kind }); };
function requestCoreTool(tool, input) {
  const id = `aibo-tool-${nextCoreToolRequestId++}`;
  return new Promise((resolve, reject) => {
    pendingCoreToolRequests.set(id, { resolve, reject });
    write({ id, method: 'aibo/tool-request', params: { agentId, sessionId: session.id, nativeSessionId: session.nativeId,
      turnId: session.turn?.id ?? null, tool, input } });
  });
}
function consumeCoreToolResponse(message) {
  if (!message || message.method || message.id === undefined) return false;
  const request = pendingCoreToolRequests.get(String(message.id));
  if (!request) return false;
  pendingCoreToolRequests.delete(String(message.id));
  if (message.error) request.reject(new Error('Core tool request rejected'));
  else request.resolve(message.result ?? {});
  return true;
}
function cancelPendingCoreToolRequests(reason) {
  for (const [id, request] of pendingCoreToolRequests) {
    pendingCoreToolRequests.delete(id);
    request.reject(new Error(reason));
  }
}
const emit = (type, payload, turnId = null, correlation = null) => write({ method: 'agent/event', params: {
  agentId, sessionId: session.id, nativeSessionId: session.nativeId, turnId, type, correlation, payload,
} });
function render() {
  write({ method: 'view/render', params: { agentId, sessionId: session.id, document: {
    schema: 'aibo.plugin-view/v1', viewId: 'dev.aibo.pi.status', revision: ++session.revision,
    title: 'Pi status', data: {}, bindings: [], actions: [], resources: [], root: {
      id: 'status', type: 'panel', props: { title: 'Pi' }, children: [
        { id: 'state', type: 'badge', props: { text: session.turn ? 'Running' : 'Ready', tone: 'info' }, children: [] },
        { id: 'native', type: 'text', props: { text: `Session: ${session.nativeId}` }, children: [] }
      ]
    }
  } } });
}
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
    isError: entry.message?.isError, summary: entry.type === 'message'
      ? sdkMessageSummary(entry.message)
      : typeof entry.summary === 'string' ? entry.summary : sdkTreeSummary(entry) };
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
function sdkModelDescriptor(model) {
  return { provider: model.provider, id: model.id, name: model.name ?? null, reasoning: model.reasoning === true,
    thinkingLevelMap: model.thinkingLevelMap ?? null };
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
  if (type === 'prompt') {
    void sdkSession.prompt(String(fields.message ?? '')).catch((error) => {
      onPi(sdkEvent({ type: 'agent_error', error: error.message }), startedProvider);
      onPi({ type: 'agent_settled' }, startedProvider);
    });
    return { success: true };
  }
  if (type === 'abort') return { success: true, data: await sdkSession.abort() };
  if (type === 'get_available_models') return { success: true, data: {
    models: startedProvider.modelRuntime.getAvailableSnapshot().map(sdkModelDescriptor),
    current: sdkSession.model ? sdkModelDescriptor(sdkSession.model) : null,
  } };
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
  if (type === 'steer' || type === 'follow_up') { await sdkSession[type === 'steer' ? 'steer' : 'followUp'](fields.message); return { success: true, data: { queued: fields.message } }; }
  if (type === 'clear_queue') { const queue = sdkSession.clearQueue(); return { success: true, data: queue }; }
  if (type === 'compact') return { success: true, data: { ...(await sdkSession.compact(fields.customInstructions || undefined)) } };
  if (type === 'get_tree') return { success: true, data: { tree: sdkTree(startedProvider), leafId: startedProvider.manager.getLeafId(), branch: sdkBranch(startedProvider) } };
  if (type === 'navigate_tree') {
    const result = await sdkSession.navigateTree(fields.entryId, { summarize: fields.summarize === true,
      customInstructions: fields.customInstructions || undefined, replaceInstructions: fields.replaceInstructions === true });
    return { success: true, data: { ...result, tree: sdkTree(startedProvider), leafId: startedProvider.manager.getLeafId() } };
  }
  if (type === 'reload') { await sdkSession.reload(); return { success: true, data: { commands: sdkCommands(sdkSession) } }; }
  throw new Error(`Unknown Pi SDK request: ${type}`);
}
function rpc(type, fields = {}) {
  const startedProvider = provider;
  if (!startedProvider) return Promise.reject(new Error('Pi unavailable'));
  if (startedProvider.kind === 'sdk') return sdkRequest(startedProvider, type, fields);
  const id = `pi-${nextId++}`;
  return new Promise((resolve, reject) => {
    startedProvider.pending.set(id, { resolve, reject });
    try {
      startedProvider.child.stdin.write(`${JSON.stringify({ id, type, ...fields })}\n`);
    } catch (error) {
      startedProvider.pending.delete(id);
      reject(error);
    }
  });
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
  } };
}
async function updateRecovery(metadata = {}) {
  if (!session || !provider) return;
  try {
    const state = await rpc('get_state');
    session.sessionFile = state.data?.sessionFile ?? session.sessionFile;
  } catch {}
  emit('session.info_changed', { ...metadata, recovery: recovery() });
}
function onPi(message, startedProvider) {
  if (provider !== startedProvider) return;
  if (startedProvider.kind !== 'sdk' && message.id !== undefined && startedProvider.pending.has(String(message.id))) {
    const request = startedProvider.pending.get(String(message.id)); startedProvider.pending.delete(String(message.id));
    message.success === false ? request.reject(new Error(message.error ?? 'Pi request failed')) : request.resolve(message);
    return;
  }
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
  if (message.type === 'session_info_changed' || message.type === 'thinking_level_changed') {
    if (message.type === 'thinking_level_changed' && typeof message.level === 'string') session.thinkingLevel = message.level;
    void updateRecovery(message.type === 'session_info_changed'
      ? { name: message.name ?? null }
      : { thinkingLevel: message.level ?? null });
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
    const text = visibleText(message.message);
    if (text) turn.finalText = text;
    completeTurnItem(turn, item, text);
  } else if (message.type === 'agent_end') {
    const final = Array.isArray(message.messages) ? message.messages.map(visibleText).filter(Boolean).at(-1) : '';
    if (final) turn.finalText = final;
    rememberAgentMessages(turn, message.messages);
    turn.aborted = message.messages?.some((item) => item?.stopReason === 'aborted') === true;
    turn.failed = message.messages?.some((item) => item?.stopReason === 'error') === true;
  } else if (message.type === 'agent_settled') {
    if (turn.items.size === 0 && (turn.finalText || turn.text)) {
      const item = newTurnItem(turn);
      item.text = turn.finalText || turn.text;
    }
    for (const item of turn.itemOrder) completeTurnItem(turn, item);
    if (turn.failed) emit('turn.failed', { message: 'Pi turn failed' }, turn.id, { requestId: turn.requestId, itemId: null });
    else emit('turn.completed', { status: turn.aborted ? 'interrupted' : 'completed' }, turn.id, { requestId: turn.requestId, itemId: null });
    session.turn = null; render(); void updateRecovery();
  }
}
async function startPi(cwd, runtimeDataPath, sessionFile, executionProfile = {}) {
  if (process.env.AIBO_PI_PLUGIN_PROVIDER !== 'rpc') return startSdkPi(cwd, runtimeDataPath, sessionFile, executionProfile);
  const args = ['--mode', 'rpc', '--session-dir', runtimeDataPath, '--name', 'aibo-pi-plugin'];
  if (sessionFile) args.push('--session', sessionFile);
  const startedChild = spawn('pi', args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  const startedProvider = { child: startedChild, lines: null, pending: new Map() };
  provider = startedProvider;
  startedChild.stderr.on('data', (chunk) => process.stderr.write(chunk));
  startedChild.on('exit', () => {
    // A close followed immediately by resume can leave the old child exit
    // notification queued after the replacement child has started. Only the
    // current provider process may reject requests or finish its turn.
    if (provider !== startedProvider) return;
    provider = null;
    for (const request of startedProvider.pending.values()) request.reject(new Error('Pi exited'));
    startedProvider.pending.clear();
    const turn = session?.turn;
    if (turn) {
      emit('turn.failed', { message: 'Pi exited' }, turn.id, { requestId: turn.requestId, itemId: null });
      session.turn = null;
      render();
    }
  });
  startedProvider.lines = readline.createInterface({ input: startedChild.stdout, crlfDelay: Infinity });
  startedProvider.lines.on('line', (line) => { try { onPi(JSON.parse(line), startedProvider); } catch (error) { process.stderr.write(`Invalid Pi frame: ${error}\n`); } });
  return rpc('get_state');
}
async function startSdkPi(cwd, runtimeDataPath, sessionFile, executionProfile = {}) {
  const modelRuntime = await ModelRuntime.create();
  let manager;
  if (sessionFile) {
    try { manager = SessionManager.open(sessionFile, runtimeDataPath, cwd); } catch {}
  }
  manager ??= SessionManager.create(cwd, runtimeDataPath);
  const workspaceWriteEnabled = executionProfile.interactionMode === 'edit' && executionProfile.filesystemPolicy === 'workspace-write';
  const commandEnabled = executionProfile.interactionMode === 'edit' && executionProfile.commandPolicy !== 'disabled';
  const customTools = [];
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
  const activeToolNames = ['read', 'grep', 'find', 'ls', ...(workspaceWriteEnabled ? ['write'] : []), ...(commandEnabled ? ['bash'] : [])];
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
      await sdkSession.setModel(model);
    }
    if (typeof executionProfile.reasoningEffort === 'string' && executionProfile.reasoningEffort.trim()) {
      const requestedLevel = executionProfile.reasoningEffort.trim();
      if (!sdkSession.getAvailableThinkingLevels().includes(requestedLevel)) {
        throw new Error(`Thinking level not found: ${requestedLevel}`);
      }
      sdkSession.setThinkingLevel(requestedLevel);
    }
  } catch (error) {
    sdkSession.dispose();
    throw error;
  }
  const startedProvider = { kind: 'sdk', sdkSession, manager, modelRuntime, pending: new Map(), unsubscribe: null };
  provider = startedProvider;
  startedProvider.unsubscribe = sdkSession.subscribe((event) => {
    const normalized = sdkEvent(event);
    if (normalized) {
      onPi(normalized, startedProvider);
      if (normalized.type === 'agent_end' && normalized.willRetry !== true) onPi({ type: 'agent_settled' }, startedProvider);
    }
  });
  return rpc('get_state');
}
async function stopPi() {
  const stoppedProvider = provider;
  if (!stoppedProvider) return;
  provider = null;
  if (stoppedProvider.kind === 'sdk') {
    cancelPendingCoreToolRequests('Pi session closed');
    stoppedProvider.unsubscribe?.();
    stoppedProvider.sdkSession.dispose();
    return;
  }
  stoppedProvider.lines?.close(); stoppedProvider.child.kill();
  for (const request of stoppedProvider.pending.values()) request.reject(new Error('Pi stopped'));
  stoppedProvider.pending.clear();
}
async function handle({ id, method, params: p }) {
  if (method === 'aibo.initialize') {
    if (initialized) fail('invalid_request');
    if (p.expectedPlugin?.pluginId !== pluginId || p.expectedPlugin?.pluginVersion !== pluginVersion) fail('manifest_mismatch');
    const grant = p.permissionGrants?.find((item) => item.id === 'workspace.read' && item.decision === 'granted' && item.enforcement === 'agent-native');
    workspaceRoots = Array.isArray(grant?.constraints?.roots) ? grant.constraints.roots : [];
    initialized = true;
    respond(id, { kind: 'initialized', pluginId, pluginVersion, runtimeProtocolVersion: '1.0', viewProtocolVersion: '1.0', agents: [{ agentId, agentVersion: null, capabilities }] }); return;
  }
  if (!initialized) fail('not_initialized');
  if (method === 'aibo.diagnose') {
    if (process.env.AIBO_PI_PLUGIN_PROVIDER === 'rpc') {
      const checked = spawnSync('pi', ['--version'], { encoding: 'utf8', timeout: 5000 }); const ready = checked.status === 0;
      respond(id, { kind: 'diagnostic', status: ready ? 'ready' : 'missing', dependencies: [{ name: 'pi', status: ready ? 'ready' : 'missing', version: ready ? checked.stdout.trim() : null }], message: ready ? null : 'Pi RPC fixture is unavailable' }); return;
    }
    respond(id, { kind: 'diagnostic', status: 'ready', dependencies: [{ name: '@earendil-works/pi-coding-agent', status: 'ready', version: '0.84.4' }], message: null }); return;
  }
  if (method === 'aibo.shutdown') { await stopPi(); respond(id, { kind: 'shutdown' }); process.stdin.destroy(); return; }
  if (p.agentId !== agentId) fail('invalid_request');
  if (method === 'session.create' || method === 'session.resume') {
    if (session || !p.workspace?.path || !workspaceRoots.includes(p.workspace.path) || typeof p.executionProfile?.runtimeDataPath !== 'string') fail('permission_denied');
    const previous = method === 'session.resume' ? p.binding?.recovery : null;
    if (previous && (previous.schema !== 'dev.aibo.pi.recovery' || previous.version !== 1)) fail('invalid_recovery_data');
    const state = await startPi(p.workspace.path, p.executionProfile.runtimeDataPath, previous?.data?.sessionFile ?? null, p.executionProfile);
    const nativeId = state.data?.sessionId;
    if (!nativeId) fail('invalid_session', 'Pi did not return a session id');
    const model = previous?.data?.model ?? state.data?.model;
    session = { id: p.sessionId, nativeId, sessionFile: state.data?.sessionFile ?? null,
      model: model && typeof model.provider === 'string' && typeof model.modelId === 'string' ? model : null,
      thinkingLevel: typeof (previous?.data?.thinkingLevel ?? state.data?.thinkingLevel) === 'string'
        ? (previous?.data?.thinkingLevel ?? state.data?.thinkingLevel)
        : null,
      revision: 0, turn: null };
    try {
      if (session.model) await rpc('set_model', session.model);
      if (session.thinkingLevel) await rpc('set_thinking_level', { level: session.thinkingLevel });
    } catch (error) {
      await stopPi();
      session = null;
      throw error;
    }
    respond(id, { kind: 'session', agentId, sessionId: session.id, nativeSessionId: nativeId, recovery: recovery() });
    emit('session.started', { state: 'idle', nativeSandbox: false }); render(); return;
  }
  if (!session || p.sessionId !== session.id) fail('invalid_session');
  if (method === 'turn.send') {
    if (session.turn) fail('busy');
    const turn = { id: p.turnId, requestId: id, text: '', finalText: '', aborted: false, failed: false,
      nextItemNumber: 1, items: new Map(), nativeItems: new Map(), messageObjects: new WeakMap(),
      itemOrder: [], currentItem: null, agentMessages: [], toolItems: new Map() };
    session.turn = turn;
    try {
      await rpc('prompt', { message: p.input.text });
    } catch (error) {
      if (session.turn === turn) { session.turn = null; render(); }
      throw error;
    }
    respond(id, { kind: 'accepted', accepted: true }); return;
  }
  if (method === 'turn.cancel') {
    if (session.turn?.id === p.turnId) {
      cancelPendingCoreToolRequests('Pi turn cancelled');
      try {
        await rpc('abort');
      } catch (error) {
        if (session.turn?.id === p.turnId) {
          emit('turn.failed', { message: error.message }, session.turn.id, { requestId: session.turn.requestId, itemId: null });
          session.turn = null;
          render();
        }
        throw error;
      }
    }
    respond(id, { kind: 'accepted', accepted: true }); return;
  }
  if (method === 'operation.invoke') {
    let result;
    if (p.operationId === 'ext.dev.aibo.pi.model') {
      if (p.input?.action === 'list') result = await rpc('get_available_models');
      else if (p.input?.action === 'set' && p.input.provider && p.input.modelId) {
        const requestedModel = { provider: p.input.provider, modelId: p.input.modelId };
        result = await rpc('set_model', requestedModel);
        session.model = requestedModel;
        await updateRecovery();
      }
      else fail('invalid_request', 'provider and modelId are required when selecting a model');
    } else if (p.operationId === 'ext.dev.aibo.pi.reasoning') {
      if (p.input?.action === 'list') result = await rpc('get_available_thinking_levels');
      else if (p.input?.action === 'set' && p.input.level) {
        result = await rpc('set_thinking_level', { level: p.input.level });
        session.thinkingLevel = result.data?.level ?? p.input.level;
        await updateRecovery();
      }
      else fail('invalid_request', 'level is required when selecting reasoning effort');
    } else if (p.operationId === 'ext.dev.aibo.pi.commands') result = await rpc('get_commands');
    else if (p.operationId === 'ext.dev.aibo.pi.skills') result = await rpc('get_skills');
    else if (p.operationId === 'ext.dev.aibo.pi.reload') result = await rpc('reload');
    else if (p.operationId === 'ext.dev.aibo.pi.queue') {
      const providerKind = provider?.kind;
      if (p.input?.action === 'clear') result = await rpc('clear_queue');
      else if (p.input?.action === 'steer' && p.input.message) result = await rpc('steer', { message: p.input.message });
      else if (p.input?.action === 'followUp' && p.input.message) result = await rpc('follow_up', { message: p.input.message });
      else fail('invalid_request', 'message is required when adding to the queue');
      if (providerKind !== 'sdk') emit('queue.updated', { ...result.data, action: p.input.action });
    } else if (p.operationId === 'ext.dev.aibo.pi.compact') {
      const providerKind = provider?.kind;
      if (providerKind !== 'sdk') emit('compaction.started', { instructions: p.input?.instructions ?? null });
      try {
        result = await rpc('compact', { customInstructions: p.input?.instructions || undefined });
        if (providerKind !== 'sdk') emit('compaction.completed', { aborted: false, willRetry: false, summary: result.data?.summary ?? null });
      } catch (error) {
        if (providerKind !== 'sdk') emit('compaction.completed', { aborted: false, willRetry: false, errorMessage: error.message });
        throw error;
      }
    }
    else if (p.operationId === 'ext.dev.aibo.pi.tree') {
      if (p.input?.action === 'get') result = await rpc('get_tree');
      else if (p.input?.action === 'navigate' && p.input.entryId) result = await rpc('navigate_tree', {
        entryId: p.input.entryId, summarize: p.input.summarize === true,
        customInstructions: p.input.customInstructions ?? null, replaceInstructions: false,
      });
      else fail('invalid_request', 'tree action and entryId are required');
    }
    else if (p.operationId === 'ext.dev.aibo.pi.snapshot') {
      result = await rpc('get_tree');
    }
    else fail('capability_unsupported');
    respond(id, { kind: 'operation', operationId: p.operationId, output: result?.data ?? {} }); return;
  }
  if (method === 'session.close') { cancelPendingCoreToolRequests('Pi session closed'); await stopPi(); session = null; respond(id, { kind: 'accepted', accepted: true }); return; }
  fail('capability_unsupported');
}
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', (line) => { let request; try { request = JSON.parse(line); if (consumeCoreToolResponse(request)) return; Promise.resolve(handle(request)).catch((error) => write({ id: request.id, error: { code: -32000, message: error.message, data: { kind: error.kind ?? 'internal', retryable: false } } })); } catch {} });
input.on('close', () => void stopPi());
