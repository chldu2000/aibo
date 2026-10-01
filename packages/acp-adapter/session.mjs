import { imageInput } from './image-input.mjs';
import { AcpTransport } from './transport.mjs';
import { modelParameters, selectValues } from './config.mjs';
import { elicitationForm } from './elicitation.mjs';

// Reply that dismisses a pending request of each kind: permissions select no option, elicitations cancel.
const CANCELLED = { outcome: { outcome: 'cancelled' } };
const cancelReply = pending => pending?.cancelled ?? CANCELLED;

/** Candidate capabilities; native negotiation narrows these before returning them to the host. */
export const BASE_CAPABILITIES = [
  'session.create', 'session.resume', 'session.close', 'turn.send', 'turn.cancel',
  'stream.text', 'approval.respond', 'command.list',
];

export function pluginError(kind, message) { return Object.assign(new Error(message), { kind }); }
export function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
export function bounded(value, max = 12_000) {
  const text = typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
const count = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
function toolPayload(label, tool, update = {}) {
  const content = update.content ?? tool.content ?? [];
  const text = Array.isArray(content) ? content.map(part => part?.content?.text ?? part?.text ?? (part?.type === 'diff' ? `${part.path ?? ''}\n${part.newText ?? ''}` : '')).filter(Boolean).join('\n') : bounded(content);
  const rawInput = object(update.rawInput ?? tool.rawInput);
  return {
    itemId: tool.toolCallId,
    itemType: tool.kind ?? 'other',
    summary: tool.title ?? `${label} tool`,
    ...(text ? { [update.status === 'completed' ? 'output' : 'delta']: bounded(text) } : {}),
    ...(typeof rawInput.command === 'string' ? { command: bounded(rawInput.command, 4_000) } : {}),
    ...(typeof rawInput.cwd === 'string' ? { cwd: bounded(rawInput.cwd, 4_000) } : {}),
    status: update.status ?? tool.status ?? 'pending',
  };
}

/**
 * Agent-specific behaviour plugged into {@link AcpSession}. Only `label`, `command`,
 * `recoverySchema`, `namespace`, `writableMode` and `validateExecutionProfile` are required.
 * @typedef {object} AcpExtension
 */
const EXTENSION_DEFAULTS = {
  args: [],
  clientName: 'aibo-acp',
  clientMeta: undefined,
  authMethodId: undefined,
  requestPrefix: 'acp',
  capabilities: BASE_CAPABILITIES,
  // Agents that persist empty sessions can always be loaded; see `open`.
  persistsEmptySessions: true,
  commandCategory: () => 'agent',
  parameterized: (_config, result) => result.configOptions.some(option => ['thought_level', 'model_config'].includes(option.category)),
  subagentFromTool: () => null,
  handleRequest: () => false,
  handleNotification: () => false,
  // Native permission options with host labels or session-control effects; see `approvalOptions`.
  approvalChoices: [],
  // Declares ACP form elicitation and answers it through host questions (user-input.respond).
  elicitation: false,
};

/**
 * Generic ACP client session mapped onto Aibo session capabilities: initialize and
 * authenticate, new/load, mode and model configuration confirmed by the agent, prompts,
 * tool and permission events, cancellation and recovery.
 */
export class AcpSession {
  constructor({ extension, transportFactory, emit = () => {}, pluginVersion = '0.1.0', cancelGraceMs = 5_000, commandWaitMs = 10_000 } = {}) {
    this.extension = { ...EXTENSION_DEFAULTS, ...extension };
    this.label = this.extension.label;
    this.transportFactory = transportFactory ?? (options => new AcpTransport({ command: this.extension.command, args: this.extension.args, label: `${this.label} ACP`, ...options }));
    this.emit = emit;
    this.pluginVersion = pluginVersion;
    this.cancelGraceMs = cancelGraceMs;
    this.commandWaitMs = commandWaitMs;
    this.commandCatalog = null;
    this.earlyCommands = new Map();
    this.commandWaiters = new Set();
    this.pendingInteractions = new Map();
    this.tools = new Map();
    this.hostPermissionReplies = new Set();
    this.completedTools = new Set();
    this.subagents = new Map();
    // Aibo usage snapshot for this process: live context from usage_update, session totals from prompt results.
    this.usage = {};
    this.phase = 'stopped';
    this.modelConfig = null;
    this.configOptions = [];
    this.parameterized = false;
    // The narrow surface extension hooks use; private state stays in the session.
    const session = this;
    this.hooks = {
      get label() { return session.label; },
      get sessionId() { return session.sessionId; },
      get turnId() { return session.turnId; },
      subagents: this.subagents,
      event: (type, payload, correlation) => this.#event(type, payload, correlation),
      respond: (id, result) => this.transport.respond(id, result),
      /** Registers a pending interaction; answers `cancelled` once 32 are waiting. */
      await: (requestId, rpcId, interaction) => {
        if (this.pendingInteractions.size >= 32) { this.transport.respond(rpcId, cancelReply(interaction)); return false; }
        this.pendingInteractions.set(requestId, { ...interaction, rpcId, turnId: this.turnId });
        return true;
      },
      updateSubagent: (subagent, changes) => this.#updateSubagent(subagent, changes),
    };
  }

  async open({ mode, workspaceId, workspacePath, executionProfile, recovery, permissions, mcpServers = [], hostMcpTools = [] }) {
    if (this.phase === 'failed' || this.transport?.closed) await this.close();
    if (this.phase !== 'stopped') {
      if (this.sessionId && this.workspaceId === workspaceId) return this.snapshot();
      throw pluginError('busy', `${this.label} session is already open`);
    }
    const policy = this.extension.validateExecutionProfile(executionProfile, permissions);
    const restored = mode === 'resume' ? this.#validateRecovery(recovery, workspaceId, workspacePath) : null;
    this.phase = 'starting';
    this.workspaceId = workspaceId;
    this.workspacePath = workspacePath;
    this.profile = policy.profile;
    this.hostMcpTools = hostMcpTools;
    this.hostMcpServerName = mcpServers[0]?.name;
    this.modeId = policy.mode;
    // Some agents do not persist a newly-created session until it receives a prompt.
    // An explicitly empty binding can then be recreated after a mode change; older or
    // prompted bindings must still load, never silently lose history.
    this.hasPrompt = restored ? restored.hasPrompt !== false : false;
    const loadNative = restored && (this.extension.persistsEmptySessions || this.hasPrompt);
    const transport = this.transportFactory({ cwd: workspacePath }).start();
    this.transport = transport;
    this.removeRequest = transport.onRequest(message => this.transport === transport && this.#handleRequest(message));
    this.removeNotification = transport.onNotification(message => { if (this.transport === transport) this.#handleNotification(message); });
    try {
      this.phase = 'initializing';
      const initialized = await transport.request('initialize', {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false, ...(this.extension.elicitation ? { elicitation: { form: {} } } : {}), ...(this.extension.clientMeta ? { _meta: this.extension.clientMeta } : {}) },
        clientInfo: { name: this.extension.clientName, version: this.pluginVersion },
      });
      if (initialized?.protocolVersion !== 1) throw pluginError('incompatible_version', `${this.label} ACP protocol v1 is required`);
      const authMethodId = this.extension.authMethodId;
      if (authMethodId && !initialized.authMethods?.some(method => method.id === authMethodId)) throw pluginError('provider_unavailable', `${this.label} did not advertise ${authMethodId} authentication`);
      this.agentCapabilities = object(initialized.agentCapabilities);
      if (authMethodId) {
        this.phase = 'authenticating';
        await transport.request('authenticate', { methodId: authMethodId });
      }
      this.phase = loadNative ? 'loading' : 'opening';
      let result;
      if (loadNative) {
        if (this.agentCapabilities.loadSession !== true) throw pluginError('unsupported', `This ${this.label} CLI cannot restore ACP sessions`);
        result = await transport.request('session/load', { sessionId: restored.nativeSessionId, cwd: workspacePath, mcpServers }, 90_000);
        this.sessionId = restored.nativeSessionId;
      } else {
        result = await transport.request('session/new', { cwd: workspacePath, mcpServers }, 90_000);
        if (typeof result?.sessionId !== 'string' || !result.sessionId) throw pluginError('invalid_output', `${this.label} did not return a session ID`);
        this.sessionId = result.sessionId;
      }
      if (this.earlyCommands.has(this.sessionId)) this.#readCommands(this.earlyCommands.get(this.sessionId));
      this.earlyCommands.clear();
      this.#readModelConfig(result);
      await this.#selectMode(result, policy.mode);
      const requestedModel = policy.profile.model ?? restored?.modelId;
      if (requestedModel != null) await this.#setModel(requestedModel);
      const sameModel = !policy.profile.model || policy.profile.model === restored?.modelId;
      const level = policy.profile.reasoningEffort ?? (sameModel ? restored?.reasoningEffort : null);
      if (level != null) await this.#setParameter('reasoning', level);
      if (sameModel && restored?.contextWindow != null) await this.#setParameter('context', restored.contextWindow);
      this.phase = 'ready';
      this.#event('session.started', { mode: this.modeId });
      return this.snapshot();
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  async prompt({ text, turnId, attachments = [], additionalInstructions = '', writable = false }) {
    if (this.phase !== 'ready' || !this.sessionId) throw pluginError('busy', `${this.label} session is not ready`);
    // A mode the agent changed on its own while idle is put back before the next prompt.
    if (this.nativeMode !== this.modeId) await this.#restoreMode();
    const writeMode = this.#writable(this.modeId);
    if (writable !== writeMode) throw pluginError('permission_denied', writable ? `${this.label} write turn requires edit mode` : `${this.label} edit mode requires a write-authorized turn`);
    const images = imageInput(attachments, this.agentCapabilities?.promptCapabilities?.image === true, this.label);
    this.phase = 'prompting';
    this.turnId = turnId;
    this.messageText = '';
    this.reasoningText = '';
    this.messageItemId = null;
    this.reasoningItemId = null;
    this.tools.clear();
    this.hostPermissionReplies.clear();
    this.completedTools.clear();
    this.subagents.clear();
    this.expectedMode = null;
    this.modeViolation = null;
    this.#event('turn.started', {});
    // Agents parse leading slash commands before processing ordinary prompt text.
    // Prefixing settings would turn a native command into a model request.
    const promptText = !/^\s*\/\S+/.test(text) && additionalInstructions.trim() ? `${additionalInstructions.trim()}\n\n${text}` : text;
    this.hasPrompt = true;
    try {
      const result = await this.transport.request('session/prompt', {
        sessionId: this.sessionId,
        prompt: [{ type: 'text', text: promptText }, ...images],
      }, 12 * 60 * 60 * 1_000);
      if (this.messageText) this.#event('message.completed', { itemId: this.messageItemId, text: this.messageText }, { itemId: this.messageItemId });
      if (this.reasoningText) this.#event('reasoning.completed', { itemId: this.reasoningItemId, summary: this.reasoningText }, { itemId: this.reasoningItemId });
      this.#addTurnUsage(result?.usage);
      const stopReason = result?.stopReason;
      const status = this.modeViolation ? 'failed' : stopReason === 'end_turn' || stopReason === 'refusal' ? 'completed'
        : ['cancelled', 'max_tokens', 'max_turn_requests'].includes(stopReason) ? 'interrupted' : 'failed';
      this.#finishSubagents(
        status === 'interrupted' ? 'interrupted' : status === 'failed' ? 'failed' : 'unavailable',
        status === 'interrupted' ? 'Parent turn was interrupted.' : status === 'failed' ? 'Parent turn failed.' : `${this.label} did not provide a final task notification.`,
      );
      this.#event(status === 'failed' ? 'turn.failed' : 'turn.completed', { status, stopReason: stopReason ?? null, ...(this.modeViolation ? { message: this.modeViolation } : {}) });
      return { status, recovery: this.recovery() };
    } catch (error) {
      if (this.phase === 'cancelling' && this.modeViolation) {
        this.#finishSubagents('failed', 'Parent turn failed.');
        this.#event('turn.failed', { status: 'failed', message: this.modeViolation });
        return { status: 'failed', recovery: this.recovery() };
      }
      if (this.phase === 'cancelling') {
        this.#finishSubagents('interrupted', 'Parent turn was cancelled.');
        this.#event('turn.completed', { status: 'interrupted', stopReason: 'cancelled', forced: true });
        return { status: 'interrupted', recovery: this.recovery() };
      }
      this.#finishSubagents('failed', `${this.label} task status became unavailable after a transport failure.`);
      this.#event('turn.failed', { status: 'failed', message: String(error?.message ?? error).slice(0, 2_000) });
      if (this.transport && !this.transport.closed) await this.transport.close();
      throw error;
    } finally {
      clearTimeout(this.cancelTimer);
      if (this.phase !== 'stopped') this.phase = this.transport?.closed ? 'failed' : 'ready';
      this.turnId = null;
      this.expectedMode = null;
      this.pendingInteractions.clear();
    }
  }

  async cancel() {
    if (!this.sessionId || this.phase !== 'prompting') return { accepted: true };
    for (const [requestId, pending] of this.pendingInteractions) {
      this.transport.respond(pending.rpcId, cancelReply(pending));
      this.#event(pending.kind === 'question' ? 'user_input.resolved' : 'approval.resolved', { requestId, decision: 'cancel' }, { requestId, ...(pending.kind === 'permission' ? { approvalId: pending.rpcId } : {}) });
    }
    this.pendingInteractions.clear();
    this.phase = 'cancelling';
    this.transport.notify('session/cancel', { sessionId: this.sessionId });
    clearTimeout(this.cancelTimer);
    this.cancelTimer = setTimeout(() => {
      if (this.phase === 'cancelling') void this.transport?.close();
    }, this.cancelGraceMs);
    this.cancelTimer.unref?.();
    return { accepted: true };
  }

  /**
   * Answers an approval with a host decision (`accept` / `cancel`) or, for option approvals, the
   * `{ optionId }` of one offered option. Standard permission requests only ever select the once
   * options; extension approvals encode their own outcome.
   */
  respondApproval(requestId, answer) {
    const pending = this.pendingInteractions.get(requestId);
    if (!pending || pending.turnId !== this.turnId || !(pending.kind === 'permission' || pending.approve)) throw pluginError('invalid_input', `${this.label} approval request is no longer pending`);
    const chosen = typeof answer === 'object' && answer !== null ? pending.offered?.find(option => option.id === answer.optionId) : null;
    if (typeof answer === 'object' && answer !== null && !chosen) throw pluginError('invalid_input', `${this.label} approval option is not offered`);
    const decision = chosen ? (chosen.kind === 'allow' ? 'accept' : 'cancel') : answer;
    // The host has already committed this option's session control; the agent's mode report must match it.
    const transition = chosen && pending.transitions?.get(chosen.id);
    if (transition) this.expectedMode = { mode: transition.mode, profile: { ...this.profile, ...transition.profile } };
    if (pending.kind === 'permission') {
      const kind = decision === 'accept' ? 'allow_once' : 'reject_once';
      const option = chosen ? pending.options.find(candidate => candidate.optionId === chosen.id) : pending.options.find(candidate => candidate.kind === kind);
      if (!option) this.transport.respond(pending.rpcId, { outcome: { outcome: 'cancelled' } });
      else this.transport.respond(pending.rpcId, { outcome: { outcome: 'selected', optionId: option.optionId } });
    } else {
      this.transport.respond(pending.rpcId, pending.approve(chosen ? { optionId: chosen.id } : decision));
    }
    this.pendingInteractions.delete(requestId);
    this.#event('approval.resolved', { requestId, decision }, { requestId, approvalId: pending.rpcId });
    return { resolved: true, recovery: this.recovery(), capabilities: this.capabilities() };
  }

  /** User input comes from extension requests; their `answer` validates and encodes the reply. */
  respondUserInput(requestId, answers) {
    const pending = this.pendingInteractions.get(requestId);
    if (!pending || pending.turnId !== this.turnId || pending.kind !== 'question' || !pending.answer) throw pluginError('invalid_input', `${this.label} question is no longer pending`);
    this.transport.respond(pending.rpcId, pending.answer(answers));
    this.pendingInteractions.delete(requestId);
    this.#event('user_input.resolved', { requestId }, { requestId });
    return { resolved: true, recovery: this.recovery(), capabilities: this.capabilities() };
  }

  capabilities() {
    const capabilities = this.extension.capabilities.filter(capability => capability !== 'session.resume' || this.agentCapabilities?.loadSession === true);
    if (this.extension.elicitation && !capabilities.includes('user-input.respond')) capabilities.push('user-input.respond');
    if (this.hostToolsRegistered) capabilities.push('host-tools');
    if (this.agentCapabilities?.promptCapabilities?.image === true) capabilities.push('image.input');
    if (!this.modelConfig) return capabilities;
    capabilities.push('model.select');
    if (!this.parameterized) return capabilities;
    // A parameterized picker exposes parameters per model, so it may claim both before the current
    // model has any; otherwise only parameters the agent actually returned are claimed.
    const parameters = this.parameters(), picker = this.extension.parameterizedPicker === true;
    if (picker || parameters.levels.length) capabilities.push('model.reasoning');
    if (picker || parameters.context) capabilities.push('model.context-window');
    return capabilities;
  }

  async commands() {
    if (!this.sessionId || !this.transport || this.transport.closed) throw pluginError('invalid_session', `${this.label} command directory requires an open session`);
    const transport = this.transport, sessionId = this.sessionId;
    if (this.commandCatalog === null) {
      await new Promise(resolve => {
        const done = () => { clearTimeout(timer); this.commandWaiters.delete(done); resolve(); };
        const timer = setTimeout(done, this.commandWaitMs);
        this.commandWaiters.add(done);
      });
    }
    if (this.transport !== transport || this.sessionId !== sessionId || transport.closed) throw pluginError('invalid_session', `${this.label} session changed while loading commands`);
    return { commands: (this.commandCatalog ?? []).map(command => ({ ...command })) };
  }

  #readCommands(available) {
    if (!Array.isArray(available)) return;
    const seen = new Set();
    this.commandCatalog = available.slice(0, 512).flatMap(command => {
      if (typeof command?.name !== 'string' || !/^[^\s/\x00-\x1f\x7f][^\s\x00-\x1f\x7f]{0,255}$/.test(command.name)) return [];
      const key = command.name.toLowerCase();
      if (seen.has(key)) return [];
      seen.add(key);
      const category = this.extension.commandCategory(command);
      return [{ name: command.name, description: typeof command.description === 'string' ? command.description.slice(0, 4000) : null,
        source: category, category, execution: 'prompt',
        ...(typeof command.input?.hint === 'string' ? { argumentHint: command.input.hint.slice(0, 1000) } : {}),
      }];
    });
    for (const done of this.commandWaiters) done();
  }

  parameters() { return modelParameters(this.configOptions ?? [], this.modelConfig?.current); }

  async configure(kind, input) {
    if (this.phase !== 'ready' || !this.sessionId) throw pluginError('busy', `${this.label} configuration requires an idle session`);
    if (!['reasoning', 'context'].includes(kind)) throw pluginError('invalid_input', `Unknown ${this.label} configuration`);
    if (input.action === 'set') {
      const transport = this.transport;
      this.phase = 'configuring';
      try { await this.#setParameter(kind, kind === 'reasoning' ? input.level : input.contextWindow); }
      finally { if (this.transport === transport && this.phase === 'configuring') this.phase = 'ready'; }
    } else if (input.action !== 'list') throw pluginError('invalid_input', `Unknown ${this.label} configuration action`);
    const parameters = this.parameters();
    return kind === 'reasoning'
      ? { current: parameters.current, levels: parameters.levels.map(({ values, ...level }) => level), recovery: this.recovery(parameters), capabilities: this.capabilities() }
      : { current: parameters.context?.currentValue ?? null, contextWindows: parameters.contextWindows, recovery: this.recovery(parameters), capabilities: this.capabilities() };
  }

  async #setParameter(kind, value) {
    const parameters = this.parameters();
    const values = kind === 'reasoning' ? parameters.levels.find(level => level.id === value)?.values
      : parameters.contextWindows.some(option => option.id === value) ? [{ id: parameters.context.id, value }] : null;
    if (!values) throw pluginError('invalid_input', `${this.label} parameter is not in the current model catalog`);
    const model = this.modelConfig.current;
    for (const selection of values) {
      if (this.modelConfig?.current !== model) throw pluginError('invalid_session', `${this.label} model changed during configuration`);
      const config = this.configOptions.find(config => config.id === selection.id);
      if (!selectValues(config).some(option => option.value === selection.value)) throw pluginError('invalid_input', `${this.label} parameter options changed during configuration`);
      if (config.currentValue === selection.value) continue;
      const transport = this.transport, sessionId = this.sessionId;
      const result = await transport.request('session/set_config_option', { sessionId, configId: selection.id, value: selection.value });
      if (this.transport !== transport || this.sessionId !== sessionId || transport.closed) throw pluginError('invalid_session', `${this.label} session changed during configuration`);
      this.#readModelConfig(result);
      if (!Array.isArray(result?.configOptions) || this.modelConfig?.current !== model || this.configOptions.find(config => config.id === selection.id)?.currentValue !== selection.value) throw pluginError('invalid_output', `${this.label} did not confirm the requested parameter`);
    }
    const confirmed = this.parameters();
    if ((kind === 'reasoning' ? confirmed.current : confirmed.context?.currentValue) !== value) throw pluginError('invalid_output', `${this.label} did not confirm the requested parameter combination`);
  }

  async models(input) {
    if (this.phase !== 'ready' || !this.sessionId) throw pluginError('busy', `${this.label} model configuration requires an idle session`);
    if (!this.modelConfig) throw pluginError('unsupported', `${this.label} did not provide model configuration`);
    if (input.action === 'set') {
      const transport = this.transport;
      this.phase = 'configuring';
      try { await this.#setModel(input.reference); }
      finally { if (this.transport === transport && this.phase === 'configuring') this.phase = 'ready'; }
    } else if (input.action !== 'list') throw pluginError('invalid_input', `Unknown ${this.label} model action`);
    const parameters = this.parameters();
    return { current: this.modelConfig.current, currentContextWindow: parameters.context?.currentValue ?? null,
      ...(this.extension.parameterScope ? { parameterScope: this.extension.parameterScope } : {}),
      models: this.modelConfig.models.map(model => ({ ...model, reasoningEfforts: model.reference === this.modelConfig.current ? parameters.levels.map(({ values, ...level }) => level) : [], contextWindows: model.reference === this.modelConfig.current ? parameters.contextWindows : [] })), recovery: this.recovery(parameters), capabilities: this.capabilities() };
  }

  #readModelConfig(result) {
    if (!Array.isArray(result?.configOptions)) return;
    this.configOptions = result.configOptions;
    const config = result.configOptions.find(option => option.category === 'model' || option.id === 'model');
    if (!config || config.type && config.type !== 'select' || typeof config.id !== 'string' || typeof config.currentValue !== 'string') {
      this.modelConfig = null;
      this.configOptions = [];
      this.parameterized = false;
      return;
    }
    this.parameterized ||= this.extension.parameterized(config, result);
    const models = selectValues(config).map(option => ({
      id: option.value, reference: option.value, displayName: option.name || option.value,
      description: option.description ?? null,
    }));
    // The directory describes choices, not subscription entitlements.
    this.modelConfig = models.length ? { id: config.id, current: config.currentValue, models } : null;
  }

  async #setModel(reference) {
    const config = this.modelConfig;
    if (!config) throw pluginError('unsupported', `${this.label} did not provide model configuration`);
    if (typeof reference !== 'string' || !config.models.some(model => model.reference === reference)) throw pluginError('invalid_input', `${this.label} model is not in the session catalog`);
    if (config.current === reference) return;
    const transport = this.transport, sessionId = this.sessionId;
    const result = await transport.request('session/set_config_option', { sessionId, configId: config.id, value: reference });
    if (this.transport !== transport || this.sessionId !== sessionId || transport.closed) throw pluginError('invalid_session', `${this.label} session changed during model selection`);
    this.#readModelConfig(result);
    if (!Array.isArray(result?.configOptions) || this.modelConfig?.current !== reference) throw pluginError('invalid_output', `${this.label} did not confirm the requested model`);
  }

  snapshot() { return { nativeSessionId: this.sessionId, recovery: this.recovery(), capabilities: this.capabilities() }; }
  recovery(parameters = this.parameters()) {
    return { schema: this.extension.recoverySchema, version: 1, data: { nativeSessionId: this.sessionId, workspaceId: this.workspaceId, workspacePath: this.workspacePath, protocolVersion: 1, modeId: this.modeId, hostMcpServerName: this.hostMcpServerName, hasPrompt: this.hasPrompt, ...(this.modelConfig ? { modelId: this.modelConfig.current, reasoningEffort: parameters.current, contextWindow: parameters.context?.currentValue ?? null } : {}) } };
  }

  async close() {
    clearTimeout(this.cancelTimer);
    const transport = this.transport;
    if (transport && !transport.closed) {
      for (const pending of this.pendingInteractions.values()) {
        try { transport.respond(pending.rpcId, cancelReply(pending)); } catch { /* process is already unavailable */ }
      }
    }
    this.removeRequest?.(); this.removeNotification?.();
    this.transport = null;
    this.commandCatalog = null;
    this.earlyCommands.clear();
    for (const done of this.commandWaiters) done();
    this.pendingInteractions.clear();
    this.phase = 'stopped';
    this.hostMcpTools=[];
    this.hostPermissionReplies.clear();
    this.sessionId = null;
    this.modelConfig = null;
    this.configOptions = [];
    this.parameterized = false;
    if (transport) await transport.close();
    return { accepted: true };
  }

  async #selectMode(result, expected) {
    const options = result?.configOptions ?? [];
    const mode = options.find(option => option.id === 'mode');
    const available = mode?.options ?? result?.modes?.availableModes ?? [];
    const values = new Set(available.map(option => option.value ?? option.id));
    if (!values.has(expected)) throw pluginError('unsupported', `${this.label} does not support ${expected} mode`);
    const current = mode?.currentValue ?? result?.modes?.currentModeId;
    this.modeApi = mode ? 'config' : 'modes';
    this.nativeMode = expected;
    if (current === expected) return;
    if (!mode) {
      // Agents exposing only the session modes API switch with session/set_mode; its
      // successful response is the agent's confirmation that the mode is active.
      await this.transport.request('session/set_mode', { sessionId: this.sessionId, modeId: expected });
      return;
    }
    const changed = await this.transport.request('session/set_config_option', { sessionId: this.sessionId, configId: 'mode', value: expected });
    this.#readModelConfig(changed);
    const updated = changed?.configOptions?.find(option => option.id === 'mode')?.currentValue;
    if (updated !== expected) throw pluginError('invalid_output', `${this.label} did not confirm the requested mode`);
  }

  #writable(mode) {
    return mode != null && (this.extension.writableModes ?? [this.extension.writableMode]).includes(mode);
  }

  async #restoreMode() {
    if (this.modeApi === 'config') {
      const changed = await this.transport.request('session/set_config_option', { sessionId: this.sessionId, configId: 'mode', value: this.modeId });
      this.#readModelConfig(changed);
      if (changed?.configOptions?.find(option => option.id === 'mode')?.currentValue !== this.modeId) throw pluginError('invalid_output', `${this.label} did not confirm the requested mode`);
    } else {
      await this.transport.request('session/set_mode', { sessionId: this.sessionId, modeId: this.modeId });
    }
    this.nativeMode = this.modeId;
  }

  /**
   * Native mode reports. A switch the host committed through an approval option is adopted; any
   * other switch during a turn fails it, because the host still enforces the previous control.
   */
  #observeMode(mode) {
    this.nativeMode = mode;
    if (mode === this.modeId) return;
    if (this.expectedMode?.mode === mode) {
      this.modeId = mode;
      this.profile = this.expectedMode.profile;
      this.expectedMode = null;
      return;
    }
    if (this.phase !== 'prompting' || this.modeViolation) return;
    this.modeViolation = `${this.label} switched to ${String(mode).slice(0, 80)} mode without host approval; the turn was stopped`;
    void this.cancel();
  }

  /** Approval options shown to the user: host labels, and session-control effects the host commits. */
  #approvalOffer(params, options, writable) {
    const toolKind = params.toolCall?.kind;
    const offered = [], transitions = new Map();
    for (const option of options) {
      if (typeof option?.optionId !== 'string' || !option.optionId || option.optionId.length > 256 || offered.some(entry => entry.id === option.optionId)) continue;
      const choice = this.extension.approvalChoices.find(entry => entry.optionId === option.optionId && (entry.toolKind === undefined || entry.toolKind === toolKind));
      const allow = String(option.kind).startsWith('allow_');
      const eligible = choice?.sessionControl ? true : writable ? ['allow_once', 'reject_once'].includes(option.kind) : option.kind === 'reject_once';
      if (!eligible) continue;
      offered.push({ id: option.optionId, kind: allow ? 'allow' : 'reject', ...(choice?.label ? { label: choice.label } : {}), ...(choice?.sessionControl ? { effects: { sessionControl: choice.sessionControl, ...(choice.contextReset ? { contextReset: true } : {}) } } : {}) });
      if (choice?.sessionControl) transitions.set(option.optionId, { mode: choice.mode, profile: choice.profile });
    }
    return { offered: offered.slice(0, 16), transitions };
  }

  #validateRecovery(value, workspaceId, workspacePath) {
    const recovery = object(value);
    const data = object(recovery.data);
    if (recovery.schema !== this.extension.recoverySchema || recovery.version !== 1 || typeof data.nativeSessionId !== 'string' || !data.nativeSessionId) throw pluginError('invalid_input', `Invalid ${this.label} recovery data`);
    if (data.workspaceId !== workspaceId || data.workspacePath !== workspacePath) throw pluginError('permission_denied', `${this.label} recovery belongs to another workspace`);
    if (data.hasPrompt !== undefined && typeof data.hasPrompt !== 'boolean') throw pluginError('invalid_input', `Invalid ${this.label} prompt recovery state`);
    return data;
  }

  #handleRequest(message) {
    const elicitation = message.method === 'elicitation/create' && this.extension.elicitation;
    const dismiss = elicitation ? { action: 'cancel' } : CANCELLED;
    if (!this.turnId || this.phase === 'loading') {
      this.transport.respond(message.id, dismiss);
      return true;
    }
    const params = object(message.params);
    if (params.sessionId != null && params.sessionId !== this.sessionId) {
      this.transport.respond(message.id, dismiss);
      return true;
    }
    const requestId = `${this.extension.requestPrefix}-${typeof message.id === 'number' ? 'n' : 's'}-${String(message.id)}`;
    if (message.method === 'session/request_permission') {
      const options = Array.isArray(params.options) ? params.options : [];
      // Only native structured metadata correlated with this turn can identify
      // the private, randomly named host bridge. Display titles grant nothing.
      const toolCallId=params.toolCall?.toolCallId;
      const tool=this.tools.get(toolCallId);
      const raw=tool?.rawInput;
      const hostRead=this.phase==='prompting' && params.sessionId===this.sessionId
        && tool?.kind==='other' && !this.completedTools.has(toolCallId)
        && this.hostMcpTools?.some(allowed=>raw?.providerIdentifier===allowed.providerIdentifier && raw?.toolName===allowed.toolName);
      if(hostRead){
        const allowed=options.find(option=>option.kind==='allow_once');
        const fresh=!this.hostPermissionReplies.has(requestId);
        this.hostPermissionReplies.add(requestId);
        this.transport.respond(message.id,allowed&&fresh?{outcome:{outcome:'selected',optionId:allowed.optionId}}:{outcome:{outcome:'cancelled'}});
        return true;
      }
      const writable = this.#writable(this.modeId) && ['user', 'auto-review'].includes(this.profile.approvalReviewer);
      // Persistent allow_always / reject_always grants are never offered: the host approves each request.
      // Outside a writable mode only declared transitions (for example approving a plan) reach the user.
      const offer = this.extension.approvalOptions ? this.#approvalOffer(params, options, writable) : {
        offered: options.filter(option => ['allow_once', 'reject_once'].includes(option.kind)).map(option => ({ id: option.optionId, kind: option.kind === 'allow_once' ? 'allow' : 'reject' })),
        transitions: new Map(),
      };
      if (!writable && offer.transitions.size === 0) {
        const rejected = options.find(candidate => candidate.kind === 'reject_once');
        this.transport.respond(message.id, rejected ? { outcome: { outcome: 'selected', optionId: rejected.optionId } } : { outcome: { outcome: 'cancelled' } });
        return true;
      }
      const offered = offer.offered;
      if (!this.hooks.await(requestId, message.id, { kind: 'permission', options, offered, transitions: offer.transitions })) return true;
      this.#event('approval.requested', { requestId, kind: params.toolCall?.kind ?? 'tool', command: params.toolCall?.title ?? null, availableDecisions: ['accept', 'cancel'],
        ...(this.extension.approvalOptions ? { options: offered } : {}) }, { requestId, toolCallId: params.toolCall?.toolCallId ?? null, approvalId: message.id });
      return true;
    }
    if (elicitation) {
      // Only form mode is declared; a form the host question model cannot express is cancelled, never approximated.
      const form = params.mode === 'form' || params.mode === undefined ? elicitationForm(params) : null;
      if (!form) { this.transport.respond(message.id, dismiss); return true; }
      if (!this.hooks.await(requestId, message.id, { kind: 'question', answer: form.answer, cancelled: dismiss })) return true;
      this.#event('user_input.requested', { requestId, title: form.title, questions: form.questions }, { requestId, toolCallId: typeof params.toolCallId === 'string' ? params.toolCallId : null });
      return true;
    }
    return this.extension.handleRequest(this.hooks, message, params, requestId) === true;
  }

  #handleNotification(message) {
    if (message.method === 'transport/closed') {
      this.phase = 'failed';
      for (const done of this.commandWaiters) done();
      if (this.turnId) this.#event('adapter.crashed', { message: message.params?.message ?? `${this.label} ACP exited` });
      return;
    }
    if (this.extension.handleNotification(this.hooks, message) === true) return;
    if (message.method === 'session/update' && message.params?.update?.sessionUpdate === 'available_commands_update') {
      const { sessionId, update } = message.params;
      if (sessionId === this.sessionId && this.sessionId) this.#readCommands(update.availableCommands);
      else if (['opening', 'loading'].includes(this.phase) && typeof sessionId === 'string' && Array.isArray(update.availableCommands) && this.earlyCommands.size < 16) {
        this.earlyCommands.set(sessionId, update.availableCommands.slice(0, 512));
      }
      return;
    }
    if (message.method === 'session/update' && this.phase !== 'loading' && this.sessionId && message.params?.sessionId === this.sessionId && message.params?.update?.sessionUpdate === 'current_mode_update') {
      if (typeof message.params.update.currentModeId === 'string') this.#observeMode(message.params.update.currentModeId);
      return;
    }
    if (message.method === 'session/update' && this.phase !== 'loading' && message.params?.sessionId === this.sessionId && message.params?.update?.sessionUpdate === 'config_option_update') {
      this.#readModelConfig(message.params.update);
      const mode = Array.isArray(message.params.update.configOptions) ? message.params.update.configOptions.find(option => option?.id === 'mode')?.currentValue : undefined;
      if (typeof mode === 'string' && this.modeApi === 'config') this.#observeMode(mode);
      return;
    }
    if (message.method !== 'session/update' || this.phase === 'loading' || message.params?.sessionId !== this.sessionId || !this.turnId) return;
    const update = object(message.params.update);
    if (update.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') {
      const nextItemId = update.messageId ?? this.messageItemId ?? `assistant-${this.turnId}`;
      if (this.messageItemId && nextItemId !== this.messageItemId && this.messageText) {
        this.#event('message.completed', { itemId: this.messageItemId, text: this.messageText }, { itemId: this.messageItemId });
        this.messageText = '';
      }
      this.messageItemId = nextItemId;
      this.messageText += update.content.text;
      this.#event('message.delta', { itemId: this.messageItemId, delta: update.content.text }, { itemId: this.messageItemId });
      return;
    }
    if (update.sessionUpdate === 'agent_thought_chunk' && update.content?.type === 'text') {
      const nextItemId = update.messageId ?? this.reasoningItemId ?? `reasoning-${this.turnId}`;
      if (this.reasoningItemId && nextItemId !== this.reasoningItemId && this.reasoningText) {
        this.#event('reasoning.completed', { itemId: this.reasoningItemId, summary: this.reasoningText }, { itemId: this.reasoningItemId });
        this.reasoningText = '';
      }
      this.reasoningItemId = nextItemId;
      this.reasoningText += update.content.text;
      this.#event('reasoning.updated', { itemId: this.reasoningItemId, delta: update.content.text }, { itemId: this.reasoningItemId });
      return;
    }
    if (update.sessionUpdate === 'tool_call') {
      this.tools.set(update.toolCallId, { ...update });
      const started = this.extension.subagentFromTool(update);
      if (started) {
        const subagent = { id: update.toolCallId, parentId: this.sessionId, rootTurnId: this.turnId, status: 'running', ...started };
        this.subagents.set(update.toolCallId, subagent);
        this.#updateSubagent(subagent);
        return;
      }
      this.#event('tool.started', toolPayload(this.label, update, { status: 'pending' }), { itemId: update.toolCallId, toolCallId: update.toolCallId });
      if (['completed', 'failed'].includes(update.status)) {
        this.completedTools.add(update.toolCallId);
        this.#event('tool.completed', toolPayload(this.label, update), { itemId: update.toolCallId, toolCallId: update.toolCallId });
      }
      return;
    }
    if (update.sessionUpdate === 'tool_call_update') {
      const subagent = this.subagents.get(update.toolCallId);
      if (subagent) {
        if (update.status === 'failed') this.#updateSubagent(subagent, { status: 'failed', activity: bounded(update.rawOutput ?? update.content) || `${this.label} subagent task failed.` });
        else if (update.status === 'completed') this.#updateSubagent(subagent, { status: 'waiting', activity: `Waiting for ${this.label} task details.` });
        return;
      }
      if (this.completedTools.has(update.toolCallId)) return;
      const merged = { ...this.tools.get(update.toolCallId), ...update };
      this.tools.set(update.toolCallId, merged);
      const terminal = ['completed', 'failed'].includes(merged.status);
      if (terminal) this.completedTools.add(update.toolCallId);
      this.#event(terminal ? 'tool.completed' : 'tool.updated', toolPayload(this.label, merged, update), { itemId: update.toolCallId, toolCallId: update.toolCallId });
      return;
    }
    if (update.sessionUpdate === 'usage_update') {
      // ACP reports the live context as `used` of `size` tokens.
      this.#updateUsage({ contextTokens: count(update.used), contextWindow: count(update.size), cost: update.cost && typeof update.cost === 'object' ? update.cost : null });
      return;
    }
    if (String(update.sessionUpdate).includes('available_')) return;
    this.#event('extension.updated', { namespace: this.extension.namespace, update });
  }

  /** Adds a prompt result's per-turn usage to the session totals; cached prompt tokens count as input. */
  #addTurnUsage(usage) {
    const turn = object(usage);
    const total = count(turn.totalTokens);
    if (total === null) return;
    const output = count(turn.outputTokens) ?? 0;
    const input = (count(turn.inputTokens) ?? 0) + (count(turn.cachedReadTokens) ?? 0) + (count(turn.cachedWriteTokens) ?? 0);
    this.#updateUsage({ input: (this.usage.input ?? 0) + input, output: (this.usage.output ?? 0) + output, totalTokens: (this.usage.totalTokens ?? 0) + total });
  }

  /** Merges known values into the usage snapshot; each event carries the whole snapshot because the host replaces it. */
  #updateUsage(values) {
    const known = Object.entries(values).filter(([, value]) => value !== null);
    if (!known.length) return;
    this.usage = { ...this.usage, ...Object.fromEntries(known) };
    this.#event('usage.updated', { usage: { ...this.usage } });
  }

  #event(type, payload, correlation = null) {
    this.emit({ nativeSessionId: this.sessionId, turnId: this.turnId ?? null, type, correlation, payload });
  }

  #updateSubagent(subagent, changes = {}) {
    Object.assign(subagent, changes);
    const { id, parentId, rootTurnId, name, task, status, activity } = subagent;
    this.emit({ nativeSessionId: this.sessionId, turnId: null, type: 'subagent.updated', correlation: { itemId: id, toolCallId: id }, payload: { id, parentId, rootTurnId, name, task, status, activity } });
  }

  #finishSubagents(status, activity) {
    for (const subagent of this.subagents.values()) {
      if (!['completed', 'failed', 'interrupted', 'unavailable'].includes(subagent.status)) this.#updateSubagent(subagent, { status, activity });
    }
  }
}
