import { readFileSync } from 'node:fs';
import { serveCapability } from '@aibo/capability-runtime/stdio';
import { createHostToolChannel, hostToolDefinitions, createHostToolMcpBridge } from '@aibo/capability-runtime/host-tools';
import { AcpSession, BASE_CAPABILITIES, object, pluginError } from './session.mjs';

export const ACP_AGENT_SCHEMA = 'aibo.acp-agent/v1';
// `auto` is the edit mode reviewed by the agent's own classifier (approvalReviewer auto-review).
const INTERACTIONS = ['ask', 'plan', 'edit', 'auto'];

/**
 * Validates a plugin's `acp.json` against its manifest. Invalid configuration stops the Worker
 * before the Runtime handshake, so the host reports a startup failure instead of a broken session.
 */
export function acpAgentConfig(config, manifest) {
  const c = object(config);
  const fail = message => { throw new Error(`Invalid acp.json: ${message}`); };
  if (c.schema !== ACP_AGENT_SCHEMA) fail(`schema must be ${ACP_AGENT_SCHEMA}`);
  if (typeof c.label !== 'string' || !c.label.trim() || c.label.length > 64) fail('label must be 1-64 characters');
  const dependencies = Array.isArray(manifest.executableDependencies) ? manifest.executableDependencies : [];
  // The spawned program is exactly a declared executable; the host checks it before enabling the plugin.
  if (typeof c.command !== 'string' || !dependencies.some(entry => entry?.kind === 'executable' && entry.name === c.command)) fail('command must name an executable declared in plugin.json executableDependencies');
  const args = c.args ?? [];
  if (!Array.isArray(args) || args.length > 32 || !args.every(arg => typeof arg === 'string' && arg.length <= 1024)) fail('args must be at most 32 strings');
  const modes = object(c.modes);
  const mapped = INTERACTIONS.filter(interaction => modes[interaction] !== undefined);
  if (!mapped.length || Object.keys(modes).some(key => !INTERACTIONS.includes(key)) || !mapped.every(interaction => typeof modes[interaction] === 'string' && modes[interaction])) fail('modes must map ask, plan, edit or auto to native mode IDs');
  if (c.authMethodId !== undefined && (typeof c.authMethodId !== 'string' || !c.authMethodId)) fail('authMethodId must be a non-empty string');
  if (c.clientMeta !== undefined && (!c.clientMeta || typeof c.clientMeta !== 'object' || Array.isArray(c.clientMeta) || JSON.stringify(c.clientMeta).length > 8192)) fail('clientMeta must be an object under 8 KiB');
  if (c.persistsEmptySessions !== undefined && typeof c.persistsEmptySessions !== 'boolean') fail('persistsEmptySessions must be a boolean');
  if (c.requestPrefix !== undefined && !/^[a-z][a-z0-9-]{0,31}$/.test(c.requestPrefix)) fail('requestPrefix must be a lowercase identifier');
  if (c.elicitation !== undefined && c.elicitation !== true) fail('elicitation must be true when present');
  const contribution = manifest.contributions?.find(entry => entry.kind === 'capabilityProvider' && entry.scope === 'session');
  // Answering elicitations is the manifest's user-input.respond operation; without it the agent is never asked.
  if (c.elicitation && !contribution?.operations?.some(operation => operation.capability?.id === `${manifest.pluginId}.user-input.respond`)) fail('elicitation requires the user-input.respond operation in plugin.json');
  const approvalOptions = c.approvalOptions ?? [];
  const controls = manifest.contributions?.find(entry => entry.kind === 'capabilityProvider' && entry.scope === 'session')?.sessionControls ?? [];
  if (!Array.isArray(approvalOptions) || approvalOptions.length > 16) fail('approvalOptions must be at most 16 entries');
  for (const entry of approvalOptions) {
    const option = object(entry);
    if (Object.keys(option).some(key => !['optionId', 'toolKind', 'label', 'sessionControl', 'contextReset'].includes(key))) fail('approvalOptions entries take optionId, toolKind, label, sessionControl and contextReset');
    if (option.contextReset !== undefined && (option.contextReset !== true || option.sessionControl === undefined)) fail('approvalOptions contextReset must be true and needs a sessionControl');
    if (typeof option.optionId !== 'string' || !option.optionId || option.optionId.length > 256) fail('approvalOptions optionId must be a native option ID');
    if (option.toolKind !== undefined && (typeof option.toolKind !== 'string' || !option.toolKind)) fail('approvalOptions toolKind must be an ACP tool kind');
    if (option.label !== undefined && (typeof option.label !== 'string' || !option.label.trim() || option.label.length > 80)) fail('approvalOptions label must be 1-80 characters');
    if (option.label === undefined && option.sessionControl === undefined) fail('approvalOptions entries need a label or a sessionControl');
    if (option.sessionControl !== undefined) {
      const control = controls.find(candidate => candidate.id === option.sessionControl);
      if (!control) fail(`approvalOptions sessionControl ${option.sessionControl} is not declared in plugin.json`);
      if (!modes[controlInteraction(control.profile)]) fail(`approvalOptions sessionControl ${option.sessionControl} has no mapped native mode`);
      if (!controls.some(candidate => candidate.transitions?.includes(option.sessionControl))) fail(`no session control declares a transition to ${option.sessionControl}`);
    }
  }
  return { ...c, args, modes, approvalOptions };
}

/** The `modes` key a session control profile runs in: Auto is edit reviewed by the agent. */
function controlInteraction(profile) {
  const p = object(profile);
  return p.interactionMode === 'edit' && p.approvalReviewer === 'auto-review' ? 'auto' : p.interactionMode;
}

/**
 * Host execution profiles for agent-managed providers: the native mode owns file, command and
 * network permissions; edit asks the user on request, ask/plan are read-only without approvals.
 */
export function agentManagedProfile(label, modes) {
  return (profile, permissions) => {
    const p = object(profile);
    if (p.schema !== 'aibo.execution-profile/v1') throw pluginError('invalid_input', `${label} requires execution profile v1`);
    const mode = modes[controlInteraction(p)];
    if (!mode) throw pluginError('invalid_input', `${label} requires a supported interaction mode`);
    if (!permissions.includes('workspace.read')) throw pluginError('permission_denied', `${label} requires workspace.read`);
    if (p.model != null && (typeof p.model !== 'string' || !p.model.trim())) throw pluginError('invalid_input', `${label} model must be a non-empty reference`);
    if (p.reasoningEffort != null && (typeof p.reasoningEffort !== 'string' || !p.reasoningEffort)) throw pluginError('invalid_input', `${label} reasoning selection must be a non-empty ID`);
    if (p.interactionMode === 'edit') {
      if (p.filesystemPolicy !== 'agent-managed' || p.commandPolicy !== 'agent-managed') throw pluginError('unsupported', `${label} edit mode requires provider-managed file and command permissions`);
      if (!['user', 'auto-review'].includes(p.approvalReviewer) || p.approvalPolicy !== 'on-request') throw pluginError('unsupported', `${label} edit mode requires on-request approval`);
    } else if (p.filesystemPolicy !== 'read-only' || p.commandPolicy !== 'disabled' || p.approvalPolicy !== 'never' || p.approvalReviewer !== 'none') {
      throw pluginError('unsupported', `${label} ask and plan modes require read-only files, disabled commands, and no approvals`);
    }
    if (p.networkPolicy !== 'agent-managed') throw pluginError('unsupported', `${label} requires provider-managed network permissions`);
    return { mode, profile: p };
  };
}

/** Builds the session extension a configuration-only plugin runs with. */
export function extensionFromConfig(config, manifest) {
  return {
    label: config.label,
    command: config.command,
    args: config.args,
    authMethodId: config.authMethodId,
    clientMeta: config.clientMeta,
    persistsEmptySessions: config.persistsEmptySessions ?? true,
    requestPrefix: config.requestPrefix ?? 'acp',
    recoverySchema: `${manifest.pluginId}.recovery`,
    namespace: manifest.pluginId,
    capabilities: BASE_CAPABILITIES,
    // A plugin without an edit mapping never runs write-authorized turns.
    writableMode: config.modes.edit ?? null,
    writableModes: [config.modes.edit, config.modes.auto].filter(Boolean),
    validateExecutionProfile: agentManagedProfile(config.label, config.modes),
    approvalChoices: approvalChoices(config, manifest),
    elicitation: config.elicitation === true,
  };
}

/** Resolves `approvalOptions` to the native mode and profile patch each session-control effect selects. */
function approvalChoices(config, manifest) {
  const controls = manifest.contributions.find(entry => entry.kind === 'capabilityProvider' && entry.scope === 'session')?.sessionControls ?? [];
  return (config.approvalOptions ?? []).map(({ optionId, toolKind, label, sessionControl, contextReset }) => {
    const control = sessionControl && controls.find(candidate => candidate.id === sessionControl);
    return { optionId, toolKind, label, ...(control ? { sessionControl, contextReset: contextReset === true, mode: config.modes[controlInteraction(control.profile)], profile: control.profile } : {}) };
  });
}

/** Per-turn additional instructions from the optional `additionalInstructions` setting. */
export function settingsInstructions(label) {
  return settings => {
    if (settings == null) return '';
    const value = object(settings), values = object(value.values);
    if (value.schema !== 'aibo.agent-settings/v1' || value.version !== 1) throw pluginError('invalid_input', `${label} received invalid agent settings`);
    if (values.additionalInstructions === undefined) return '';
    if (typeof values.additionalInstructions !== 'string' || values.additionalInstructions.length > 8_000) throw pluginError('invalid_input', `${label} received invalid agent settings`);
    return values.additionalInstructions;
  };
}

/**
 * Serves an ACP agent as an Aibo Runtime 2.1 session provider. Optional features use the
 * manifest's `<pluginId>.<feature>` capability IDs. Configuration-only plugins pass `configUrl`
 * (`acp.json`); plugins with agent-specific code pass their own `extension`.
 */
export function serveAcpAgent({ manifestUrl, configUrl, extension, additionalInstructions }) {
  const manifest = JSON.parse(readFileSync(manifestUrl, 'utf8'));
  const contribution = manifest.contributions.find(entry => entry.kind === 'capabilityProvider' && entry.scope === 'session');
  if (!contribution) throw new Error('plugin.json has no session capability provider');
  const configured = extension ?? extensionFromConfig(acpAgentConfig(JSON.parse(readFileSync(configUrl, 'utf8')), manifest), manifest);
  // The declared approval.respond variant decides how approvals are answered: by option or by decision.
  const approvalOperation = contribution.operations.find(operation => operation.capability.id === `${manifest.pluginId}.approval.respond`);
  const active = { ...configured, approvalOptions: approvalOperation?.inputSchema?.properties?.optionId !== undefined };
  if (configured.approvalChoices?.length && !active.approvalOptions) throw new Error('Invalid acp.json: approvalOptions require the { requestId, optionId } approval.respond input');
  const label = active.label, feature = name => `${manifest.pluginId}.${name}`;
  const instructions = additionalInstructions ?? settingsInstructions(label);
  let owner, bridge;
  const hostTools = createHostToolChannel();
  const session = new AcpSession({ extension: active, pluginVersion: manifest.version, emit(event) { owner?.tools.emit(event); } });
  async function closeBridge() { const old = bridge; bridge = undefined; session.hostToolsRegistered = false; await old?.close(); }

  function inputOf(request) {
    if (!request.input || typeof request.input !== 'object' || Array.isArray(request.input)) throw Object.assign(new Error('Object input required'), { kind: 'invalid_input' });
    return request.input;
  }
  function contextOf(request) {
    const context = request.context;
    if (request.scope?.kind !== 'session' || typeof request.scope.id !== 'string' || !request.scope.id || typeof context?.workspaceId !== 'string' || !context.workspaceId || typeof context.workspacePath !== 'string' || !context.workspacePath || !Array.isArray(context.permissions) || !context.permissions.includes('workspace.read')) {
      throw Object.assign(new Error(`${label} requires a trusted session workspace`), { kind: 'permission_denied' });
    }
    return context;
  }
  async function commandDirectory() {
    const output = await session.commands();
    return { ...output, recovery: session.recovery(), capabilities: session.capabilities(),
      commands: output.commands.map(command => ({ ...command, insertionText: `/${command.name} ` })),
    };
  }

  async function invoke(request, tools) {
    if (owner) throw Object.assign(new Error(`${label} session invocation already running`), { kind: 'busy' });
    const context = contextOf(request);
    const input = inputOf(request);
    const abort = () => { if (request.capability === 'aibo.session.turn' || request.capability === 'aibo.session.turn.write') void session.cancel(); };
    tools.signal.addEventListener('abort', abort, { once: true });
    let endHostTools = () => {};
    owner = { request, tools };
    try {
      endHostTools = hostTools.begin(request, tools, () => session.sessionId);
      if (request.capability === 'aibo.session.open') {
        const definitions = hostToolDefinitions(context);
        if (definitions.length && !bridge) {
          bridge = await createHostToolMcpBridge({ definitions, call: hostTools.call });
          const previousName = input.recovery?.data?.hostMcpServerName;
          if (input.mode === 'resume' && /^aibo-[a-f0-9]{16}$/.test(previousName ?? '')) bridge.configuration.name = previousName;
        }
        const mcpServers = bridge ? [{ ...bridge.configuration, env: Object.entries(bridge.configuration.env).map(([name, value]) => ({ name, value })) }] : [];
        try {
          await session.open({ mode: input.mode, workspaceId: context.workspaceId, workspacePath: context.workspacePath, executionProfile: input.executionProfile, recovery: input.recovery, permissions: context.permissions, mcpServers,
            hostMcpTools: bridge ? definitions.filter(tool => tool.annotations?.readOnlyHint === true && tool.annotations?.destructiveHint === false).map(tool => ({ providerIdentifier: bridge.configuration.name, toolName: tool.name })) : [] });
          // ACP may initialize/list MCP tools lazily when the first prompt starts.
          // Successful session/new or session/load registers this session's servers.
          session.hostToolsRegistered = !!bridge;
          return session.snapshot();
        } catch (error) { await session.close(); await closeBridge(); throw error; }
      }
      if (request.capability === feature('command.list')) return await commandDirectory();
      if (request.capability === feature('model.reasoning')) return await session.configure('reasoning', input);
      if (request.capability === feature('model.context-window')) return await session.configure('context', input);
      if (request.capability === feature('model.select')) return await session.models(input);
      if (request.capability === 'aibo.session.close') { try { return await session.close(); } finally { await closeBridge(); } }
      if (request.capability === 'aibo.session.turn' || request.capability === 'aibo.session.turn.write') {
        if (!context.turnId || typeof input.text !== 'string' || !input.text.trim()) throw Object.assign(new Error(`${label} turn requires text and turn identity`), { kind: 'invalid_input' });
        if (request.capability.endsWith('.write') && !context.permissions.includes('workspace.write')) throw Object.assign(new Error(`${label} write turn requires workspace.write`), { kind: 'permission_denied' });
        const writable = request.capability.endsWith('.write');
        return await session.prompt({ text: input.text, attachments: input.attachments, turnId: context.turnId, additionalInstructions: instructions(context.settings), writable });
      }
      throw Object.assign(new Error(`Unsupported ${label} capability`), { kind: 'unsupported' });
    } finally {
      endHostTools();
      tools.signal.removeEventListener('abort', abort);
      owner = undefined;
    }
  }

  async function control(request, { invocation }) {
    if (!owner || owner.request.invocationId !== invocation.invocationId) throw Object.assign(new Error(`No matching ${label} invocation`), { kind: 'invalid_input' });
    const input = inputOf(request);
    if (request.capability === 'aibo.session.tool.respond') return hostTools.respond(input);
    if (request.capability === feature('command.list')) return await commandDirectory();
    if (request.capability.startsWith(feature('model.'))) throw Object.assign(new Error(`${label} model configuration requires an idle session`), { kind: 'busy' });
    if (request.capability === 'aibo.session.cancel') return session.cancel();
    if (request.capability === feature('approval.respond')) return session.respondApproval(input.requestId, input.optionId !== undefined ? { optionId: input.optionId } : input.decision);
    if (request.capability === feature('user-input.respond')) return session.respondUserInput(input.requestId, input.answers);
    throw Object.assign(new Error(`Unsupported ${label} control`), { kind: 'unsupported' });
  }

  serveCapability({
    protocol: '2.1', pluginId: manifest.pluginId, pluginVersion: manifest.version, contributionId: contribution.id,
    operations: contribution.operations.map(operation => ({ capability: operation.capability.id, version: operation.capability.version, operationId: operation.id })),
    invoke, control,
  });
  process.stdin.on('end', () => { void session.close(); void closeBridge(); });
  return session;
}
