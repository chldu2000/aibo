import { mkdir } from 'node:fs/promises';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  createBashToolDefinition as createSdkBashToolDefinition,
  createReadToolDefinition as createSdkReadToolDefinition,
  createWriteToolDefinition as createSdkWriteToolDefinition,
} from '@earendil-works/pi-coding-agent';

const MODELS = [{
  provider: 'fake',
  id: 'fake-model',
  name: 'Parity model',
  reasoning: true,
  input: [],
  thinkingLevelMap: { off: 'off', high: 'high' },
}];

function textMessage(role, text) {
  return { role, content: [{ type: 'text', text }], stopReason: role === 'assistant' ? 'stop' : undefined };
}

function entry(id, parentId, role, text, timestamp) {
  return {
    id,
    parentId,
    type: 'message',
    timestamp,
    message: textMessage(role, text),
  };
}

class FakeSessionManager {
  constructor(cwd, sessionDir, id = 'fake-pi-session') {
    this.cwd = cwd;
    this.sessionDir = sessionDir;
    this.id = id;
    this.file = path.join(sessionDir, `${id}.jsonl`);
    this.entries = [];
    this.leafId = null;
    if (existsSync(this.file)) {
      for (const line of readFileSync(this.file, 'utf8').split('\n').filter(Boolean)) {
        try { this.entries.push(JSON.parse(line)); } catch { /* ignore an incomplete fixture line */ }
      }
      this.leafId = this.entries.at(-1)?.id ?? null;
    }
  }

  static create(cwd, sessionDir) {
    return new FakeSessionManager(cwd, sessionDir);
  }

  static async list(_cwd, sessionDir) {
    return readdirSync(sessionDir, { withFileTypes: true })
      .filter((item) => item.isFile() && item.name.endsWith('.jsonl'))
      .map((item) => ({ id: item.name.slice(0, -'.jsonl'.length), path: path.join(sessionDir, item.name) }));
  }

  static open(file, sessionDir, cwd) {
    return new FakeSessionManager(cwd, sessionDir, path.basename(file, '.jsonl'));
  }

  getSessionId() { return this.id; }
  getSessionFile() { return this.file; }
  getCwd() { return this.cwd; }
  getSessionName() { return 'Pi parity session'; }
  getLeafId() { return this.leafId; }
  getEntries() { return this.entries.slice(); }
  persist() { writeFileSync(this.file, `${this.entries.map((item) => JSON.stringify(item)).join('\n')}\n`); }
  appendModelChange(provider, modelId) {
    const id = `model-${this.entries.length + 1}`;
    this.entries.push({ id, parentId: this.leafId, type: 'model_change', provider, modelId, timestamp: new Date().toISOString() });
    this.leafId = id;
    this.persist();
  }

  appendThinkingLevelChange(thinkingLevel) {
    const id = `thinking-${this.entries.length + 1}`;
    this.entries.push({ id, parentId: this.leafId, type: 'thinking_level_change', thinkingLevel, timestamp: new Date().toISOString() });
    this.leafId = id;
    this.persist();
  }

  appendTurn(text) {
    const now = new Date().toISOString();
    const userId = `user-${this.entries.length + 1}`;
    const assistantId = `assistant-${this.entries.length + 2}`;
    this.entries.push(entry(userId, this.leafId, 'user', text, now));
    this.entries.push(entry(assistantId, userId, 'assistant', text, new Date(Date.parse(now) + 1).toISOString()));
    this.leafId = assistantId;
    this.persist();
  }

  getTree() {
    const nodes = new Map(this.entries.map((item) => [item.id, { entry: item, label: undefined, children: [] }]));
    const roots = [];
    for (const node of nodes.values()) {
      const parent = node.entry.parentId ? nodes.get(node.entry.parentId) : null;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    return roots;
  }
}

class FakeModelRuntime {
  static async create() { return new FakeModelRuntime(); }
  getAvailableSnapshot() { return MODELS.slice(); }
  getModel(provider, id) { return MODELS.find((model) => model.provider === provider && model.id === id); }
  hasConfiguredAuth() { return true; }
}

class FakeSession {
  constructor(manager, modelRuntime, options = {}) {
    this.sessionManager = manager;
    this.sessionId = manager.getSessionId();
    this.sessionFile = manager.getSessionFile();
    this.modelRuntime = modelRuntime;
    this.model = MODELS[0];
    this.thinkingLevel = 'off';
    this.isStreaming = false;
    this.queueRelease = null;
    this.abortRequested = false;
    this.listeners = new Set();
    this.steering = [];
    this.followUpQueue = [];
    this.extensionRunner = { getRegisteredCommands: () => [{ invocationName: 'review', description: 'Review the current work' }] };
    this.promptTemplates = [{ name: 'summarize', description: 'Summarize the current work' }];
    this.resourceLoader = { getSkills: () => ({ skills: [{ name: 'parity', description: 'Parity skill', source: 'project', filePath: '/workspace/SKILL.md' }] }) };
    this.customTools = options.customTools ?? [];
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event) {
    for (const listener of this.listeners) listener(event);
  }

  async prompt(text) {
    this.isStreaming = true;
    this.abortRequested = false;
    if (text === 'queue parity prompt') {
      await new Promise((resolve) => { this.queueRelease = resolve; });
      this.queueRelease = null;
    }
    await new Promise((resolve) => setImmediate(resolve));
    this.emit({ type: 'agent_start' });
    if (this.abortRequested) {
      const aborted = textMessage('assistant', '');
      aborted.stopReason = 'aborted';
      this.emit({ type: 'agent_end', messages: [aborted], willRetry: false });
      this.emit({ type: 'agent_settled' });
      this.isStreaming = false;
      return;
    }
    if (text === 'retry parity prompt') {
      this.emit({ type: 'auto_retry_start', attempt: 1, maxAttempts: 2, delayMs: 0, errorMessage: 'transient provider error' });
      this.emit({ type: 'auto_retry_end', success: false, attempt: 1, finalError: 'transient provider error' });
    }
    if (text.startsWith('core plugin ')) {
      const toolName = text.includes('read') || text.includes('image') ? 'read' : text.includes('write') ? 'write' : 'bash';
      const tool = this.customTools.find((candidate) => candidate.name === toolName);
      if (!tool) throw new Error(`${toolName} tool was not installed`);
      const toolCallId = `core-${toolName}-tool`;
      const input = toolName === 'read'
        ? { path: text.includes('image') ? 'read-tool.png' : 'read-tool.txt' }
        : toolName === 'write'
          ? { path: 'core-tool.txt', content: 'Core plugin write' }
          : { command: 'printf AIBO_PLUGIN_COMMAND_OK', cwd: '.' };
      this.emit({ type: 'tool_execution_start', toolCallId, toolName, args: input });
      const result = await tool.execute(toolCallId, input, undefined, undefined, { model: this.model, sessionManager: this.sessionManager, thinkingLevel: this.thinkingLevel });
      this.emit({ type: 'tool_execution_end', toolCallId, toolName, result, isError: false });
      const message = textMessage('assistant', 'Core read completed');
      this.emit({ type: 'message_start', message });
      this.emit({ type: 'message_update', message, assistantMessageEvent: { type: 'text_delta', delta: 'Core read completed' }, usage: { input: 3, output: 19, total: 22 } });
      this.emit({ type: 'message_end', message });
      this.emit({ type: 'turn_end', message, toolResults: [result] });
      this.sessionManager.appendTurn(text);
      this.emit({ type: 'agent_end', messages: [message], willRetry: false });
      this.emit({ type: 'agent_settled' });
      this.isStreaming = false;
      return;
    }
    const emitMessage = (message, options = {}) => {
      this.emit({ type: 'message_start', message });
      this.emit({ type: 'message_update', message, assistantMessageEvent: { type: 'text_delta', delta: options.delta ?? text }, usage: { input: 3, output: text.length, total: text.length + 3 } });
      if (options.end !== false) this.emit({ type: 'message_end', message });
    };
    if (text === 'two identical no ids') {
      const first = textMessage('assistant', 'same reply');
      const second = textMessage('assistant', 'same reply');
      emitMessage(first, { delta: 'same reply' });
      emitMessage(second, { delta: 'same reply' });
      this.emit({ type: 'message_end', message: second });
      this.emit({ type: 'turn_end', message: second, toolResults: [] });
      this.sessionManager.appendTurn(text);
      this.emit({ type: 'agent_end', messages: [first, second], willRetry: false });
      this.emit({ type: 'agent_settled' });
      this.isStreaming = false;
      return;
    }
    const message = textMessage('assistant', text);
    if (text === 'missing completion') emitMessage(message, { end: false });
    else if (text === 'late completion') {
      this.emit({ type: 'message_start', message });
      this.emit({ type: 'message_update', message, assistantMessageEvent: { type: 'text_delta', delta: text }, usage: { input: 3, output: text.length, total: text.length + 3 } });
      this.emit({ type: 'agent_end', messages: [message], willRetry: false });
      this.emit({ type: 'message_end', message });
      this.emit({ type: 'turn_end', message, toolResults: [] });
      this.sessionManager.appendTurn(text);
      this.emit({ type: 'agent_settled' });
      this.isStreaming = false;
      return;
    } else emitMessage(message);
    this.emit({ type: 'turn_end', message, toolResults: [] });
    this.sessionManager.appendTurn(text);
    this.emit({ type: 'agent_end', messages: [message], willRetry: false });
    this.emit({ type: 'agent_settled' });
    this.isStreaming = false;
  }

  async abort() {
    this.abortRequested = true;
    this.queueRelease?.();
    this.isStreaming = false;
    return undefined;
  }

  clearQueue() {
    const cleared = { steering: this.steering.splice(0), followUp: this.followUpQueue.splice(0) };
    this.emit({ type: 'queue_update', steering: this.steering.slice(), followUp: this.followUpQueue.slice() });
    this.queueRelease?.();
    return cleared;
  }

  async steer(text) {
    this.steering.push(text);
    this.emit({ type: 'queue_update', steering: this.steering.slice(), followUp: this.followUpQueue.slice() });
  }

  async followUpMessage(text) {
    this.followUpQueue.push(text);
    this.emit({ type: 'queue_update', steering: this.steering.slice(), followUp: this.followUpQueue.slice() });
  }

  async followUp(text) { return this.followUpMessage(text); }

  async compact(instructions) {
    this.emit({ type: 'compaction_start', reason: 'manual' });
    const result = { summary: instructions || 'compact', firstKeptEntryId: this.sessionManager.getLeafId(), tokensBefore: 12, estimatedTokensAfter: 4 };
    this.emit({ type: 'compaction_end', reason: 'manual', aborted: false, willRetry: false, result });
    return result;
  }

  getAvailableThinkingLevels() { return ['off', 'high']; }
  setThinkingLevel(level) { this.thinkingLevel = this.getAvailableThinkingLevels().includes(level) ? level : 'off'; }
  async setModel(model) { this.model = model; }
  async reload() { return undefined; }
  async navigateTree(entryId) { this.sessionManager.leafId = entryId; return { cancelled: false, editorText: null }; }
  dispose() { this.listeners.clear(); }
}

function toolDefinition(name) {
  return { name, label: name, description: `${name} parity tool`, promptSnippet: `${name} parity tool`, parameters: { type: 'object' }, execute: async () => ({ content: [{ type: 'text', text: '' }] }) };
}

export async function createAgentSession(options = {}) {
  await mkdir(options.sessionManager?.sessionDir ?? options.cwd ?? process.cwd(), { recursive: true });
  const manager = options.sessionManager ?? FakeSessionManager.create(options.cwd ?? process.cwd(), process.cwd());
  return { session: new FakeSession(manager, options.modelRuntime ?? new FakeModelRuntime(), options) };
}

export { FakeModelRuntime as ModelRuntime, FakeSessionManager as SessionManager };
export const createBashToolDefinition = createSdkBashToolDefinition;
export const createFindToolDefinition = () => toolDefinition('find');
export const createGrepToolDefinition = () => toolDefinition('grep');
export const createLsToolDefinition = () => toolDefinition('ls');
export const createReadToolDefinition = createSdkReadToolDefinition;
export const createWriteToolDefinition = createSdkWriteToolDefinition;
