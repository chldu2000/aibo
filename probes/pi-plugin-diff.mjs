import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { JsonlProcess } from './lib/jsonl-process.mjs';
import { assertProbe, createProbeOutput } from './lib/probe-output.mjs';

const cwd = await mkdtemp(path.join(tmpdir(), 'aibo-pi-plugin-diff-'));
const fakeSdk = path.resolve('fixtures/pi/fake-sdk.mjs');
const output = await createProbeOutput('pi-plugin-diff', process.cwd());
const allowedDifferences = [
  'JSON-RPC Agent Runtime envelopes versus the legacy SDK-host envelope',
  'Core tool mediation is only present in the plugin process; this offline scenario does not invoke a tool',
  'the plugin explicitly reports nativeSandbox=false on session.started',
  'session native IDs and timestamps are normalized before comparison',
  'legacy command entries label Skill items as source=skill; the SDK Skill inventory preserves source=project',
];

function spawnProvider(label, entrypoint, sessionDir) {
  const client = new JsonlProcess(process.execPath, [entrypoint], {
    cwd: process.cwd(),
    env: { ...process.env, AIBO_PI_SDK_MODULE: fakeSdk },
  }).start();
  const messages = [];
  client.on('message', (message) => {
    messages.push(message);
    void output.appendRaw(label, message);
  });
  client.on('stderr', (message) => void output.appendRaw(`${label}-stderr`, message));
  return { client, messages, sessionDir };
}

function eventStream(provider) {
  return provider.messages.flatMap((message) => {
    if (message.method === 'aibo/event') return [{ source: 'old', ...message.params.event }];
    if (message.method === 'agent/event') return [{ source: 'plugin', ...message.params }];
    return [];
  });
}

function normalizeTree(nodes) {
  return (Array.isArray(nodes) ? nodes : []).map((node) => ({
    id: node.id ?? null,
    parentId: node.parentId ?? null,
    type: node.type ?? null,
    role: node.role ?? null,
    summary: node.summary ?? null,
    children: normalizeTree(node.children),
  }));
}

function normalizeBranch(entries) {
  return (Array.isArray(entries) ? entries : []).map((entry) => ({
    id: entry.id ?? null,
    parentId: entry.parentId ?? null,
    type: entry.type ?? null,
    role: entry.role ?? null,
    summary: entry.summary ?? null,
  }));
}

function normalizeSkills(skills) {
  return (Array.isArray(skills) ? skills : []).map((skill) => ({
    name: skill.name?.replace(/^skill:/, '') ?? null,
    description: skill.description ?? null,
    source: skill.source ?? null,
  }));
}

function normalizeEvents(provider) {
  const normalized = [];
  for (const event of eventStream(provider)) {
    const type = event.type;
    const legacy = event.event ?? event;
    if (type === 'agent_start' || type === 'turn.started') {
      normalized.push({ type: 'turn.started' });
    } else if (type === 'message_update') {
      const update = legacy.assistantMessageEvent ?? event.payload?.assistantMessageEvent;
      if (update?.type === 'text_delta' && update.delta) normalized.push({ type: 'message.delta', delta: update.delta });
      const usage = legacy.usage ?? event.payload?.usage;
      if (usage) normalized.push({ type: 'usage.updated', usage });
    } else if (type === 'message.delta') {
      normalized.push({ type, delta: event.payload?.delta ?? null });
    } else if (type === 'usage.updated') {
      normalized.push({ type, usage: event.payload?.usage ?? null });
    } else if (type === 'message_end') {
      normalized.push({ type: 'message.completed', text: legacy.message?.text ?? null });
    } else if (type === 'message.completed') {
      normalized.push({ type, text: event.payload?.text ?? null });
    } else if (type === 'auto_retry_start' || type === 'retry.started') {
      const payload = event.payload ?? legacy;
      normalized.push({ type: 'retry.started', kind: payload.kind ?? 'agent', attempt: payload.attempt ?? null });
    } else if (type === 'auto_retry_end' || type === 'retry.completed') {
      const payload = event.payload ?? legacy;
      normalized.push({ type: 'retry.completed', kind: payload.kind ?? 'agent', success: payload.success ?? null, attempt: payload.attempt ?? null });
    } else if (type === 'compaction_start' || type === 'compaction.started') {
      normalized.push({ type: 'compaction.started' });
    } else if (type === 'compaction_end' || type === 'compaction.completed') {
      const payload = event.payload ?? legacy;
      normalized.push({ type: 'compaction.completed', summary: payload.result?.summary ?? payload.summary ?? null });
    } else if (type === 'queue_update' || type === 'queue.updated') {
      const payload = event.payload ?? legacy;
      normalized.push({ type: 'queue.updated', steering: payload.steering ?? [], followUp: payload.followUp ?? [] });
    } else if (type === 'turn_end' || type === 'turn.completed') {
      normalized.push({ type: 'turn.completed', status: type === 'turn_end' ? 'completed' : event.payload?.status ?? null });
    } else if (type === 'turn.failed') {
      normalized.push({ type });
    }
  }
  return normalized;
}

function oldRequest(provider, method, params = {}) {
  return provider.client.rpcRequest(method, params);
}

function pluginRequest(provider, method, params = {}) {
  return provider.client.rpcRequest(method, params);
}

async function startOld(provider) {
  const response = await oldRequest(provider, 'start', {
    cwd,
    sessionDir: provider.sessionDir,
    executionProfile: {},
  });
  assert.equal(response.result.protocol, 'aibo-pi-sdk-host.v1');
  return response.result;
}

async function startPlugin(provider) {
  const initialize = await pluginRequest(provider, 'aibo.initialize', {
    runtimeInstanceId: 'diff-runtime',
    generationId: 'diff-generation',
    host: { appVersion: '0.1.0', platform: 'darwin-arm64', runtimeProtocolVersions: ['1.0'], viewProtocolVersions: ['1.0'] },
    expectedPlugin: { pluginId: 'dev.aibo.pi', pluginVersion: '1.0.0' },
    permissionGrants: [{ id: 'workspace.read', decision: 'granted', enforcement: 'agent-native', constraints: { roots: [cwd] } }],
  });
  assert.equal(initialize.result.kind, 'initialized');
  const response = await pluginRequest(provider, 'session.create', {
    agentId: 'dev.aibo.pi.agent',
    sessionId: 'diff-session',
    workspace: { workspaceId: 'diff-workspace', trusted: true, path: cwd },
    executionProfile: { runtimeDataPath: provider.sessionDir },
  });
  assert.equal(response.result.kind, 'session');
  return response.result;
}

async function sendTurn(provider, kind, text = 'same parity prompt', turnId = 'diff-turn') {
  const before = provider.messages.length;
  const waiter = provider.client.waitFor((message) => {
    if (kind === 'old') return message.method === 'aibo/event' && message.params.event.type === 'turn_end';
    return message.method === 'agent/event' && message.params.type === 'turn.completed';
  }, { timeoutMs: 10_000 });
  if (kind === 'old') {
    await oldRequest(provider, 'prompt', { turnId, text });
  } else {
    await pluginRequest(provider, 'turn.send', { agentId: 'dev.aibo.pi.agent', sessionId: 'diff-session', turnId, input: { text, attachments: [] } });
  }
  await waiter;
  return provider.messages.slice(before);
}

async function sendQueuedTurn(provider, kind) {
  const before = provider.messages.length;
  const turnId = 'queue-turn';
  const waiter = provider.client.waitFor((message) => {
    if (kind === 'old') return message.method === 'aibo/event' && message.params.event.type === 'turn_end';
    return message.method === 'agent/event' && message.params.type === 'turn.completed';
  }, { timeoutMs: 10_000 });
  if (kind === 'old') {
    await oldRequest(provider, 'prompt', { turnId, text: 'queue parity prompt' });
    await oldRequest(provider, 'steer', { text: 'steer parity' });
    await oldRequest(provider, 'followUp', { text: 'follow-up parity' });
    await oldRequest(provider, 'clearQueue');
  } else {
    const scope = { agentId: 'dev.aibo.pi.agent', sessionId: 'diff-session' };
    await pluginRequest(provider, 'turn.send', { ...scope, turnId, input: { text: 'queue parity prompt', attachments: [] } });
    await pluginRequest(provider, 'operation.invoke', { ...scope, operationId: 'ext.dev.aibo.pi.queue', input: { action: 'steer', message: 'steer parity' } });
    await pluginRequest(provider, 'operation.invoke', { ...scope, operationId: 'ext.dev.aibo.pi.queue', input: { action: 'followUp', message: 'follow-up parity' } });
    await pluginRequest(provider, 'operation.invoke', { ...scope, operationId: 'ext.dev.aibo.pi.queue', input: { action: 'clear' } });
  }
  await waiter;
  return provider.messages.slice(before);
}

function findUserEntry(tree) {
  const stack = [...(tree ?? [])];
  while (stack.length > 0) {
    const node = stack.shift();
    if (node.type === 'message' && node.role === 'user') return node;
    stack.push(...(node.children ?? []));
  }
  return null;
}

async function collectState(provider, kind) {
  if (kind === 'old') {
    const model = await oldRequest(provider, 'model');
    const thinking = await oldRequest(provider, 'thinking');
    const commands = await oldRequest(provider, 'commands');
    const tree = await oldRequest(provider, 'tree');
    const snapshot = await oldRequest(provider, 'snapshot');
    return {
      model: { current: model.result.current, models: model.result.models },
      thinking: { current: thinking.result.level, levels: thinking.result.availableLevels },
      commands: commands.result.commands,
      skills: commands.result.commands.filter((command) => command.source === 'skill').map((command) => ({
        name: command.name, description: command.description, source: 'project',
      })),
      tree: { leafId: tree.result.leafId, tree: tree.result.tree },
      snapshot: { leafId: snapshot.result.leafId, tree: snapshot.result.tree, branch: snapshot.result.branch },
    };
  }
  const model = await pluginRequest(provider, 'operation.invoke', { agentId: 'dev.aibo.pi.agent', sessionId: 'diff-session', operationId: 'ext.dev.aibo.pi.model', input: { action: 'list' } });
  const thinking = await pluginRequest(provider, 'operation.invoke', { agentId: 'dev.aibo.pi.agent', sessionId: 'diff-session', operationId: 'ext.dev.aibo.pi.reasoning', input: { action: 'list' } });
  const commands = await pluginRequest(provider, 'operation.invoke', { agentId: 'dev.aibo.pi.agent', sessionId: 'diff-session', operationId: 'ext.dev.aibo.pi.commands', input: {} });
  const skills = await pluginRequest(provider, 'operation.invoke', { agentId: 'dev.aibo.pi.agent', sessionId: 'diff-session', operationId: 'ext.dev.aibo.pi.skills', input: {} });
  const tree = await pluginRequest(provider, 'operation.invoke', { agentId: 'dev.aibo.pi.agent', sessionId: 'diff-session', operationId: 'ext.dev.aibo.pi.tree', input: { action: 'get' } });
  const snapshot = await pluginRequest(provider, 'operation.invoke', { agentId: 'dev.aibo.pi.agent', sessionId: 'diff-session', operationId: 'ext.dev.aibo.pi.snapshot', input: {} });
  return {
    model: { current: model.result.output.current, models: model.result.output.models },
    thinking: { current: thinking.result.output.current, levels: thinking.result.output.levels },
    commands: commands.result.output.commands,
    skills: skills.result.output.skills,
    tree: { leafId: tree.result.output.leafId, tree: tree.result.output.tree },
    snapshot: { leafId: snapshot.result.output.leafId, tree: snapshot.result.output.tree, branch: snapshot.result.output.branch },
  };
}

function comparableState(state) {
  return {
    model: state.model,
    thinking: state.thinking,
    commands: state.commands,
    skills: normalizeSkills(state.skills),
    tree: { leafId: state.tree.leafId, tree: normalizeTree(state.tree.tree) },
    snapshot: { leafId: state.snapshot.leafId, tree: normalizeTree(state.snapshot.tree), branch: normalizeBranch(state.snapshot.branch) },
  };
}

let failure = null;
let oldProvider;
let pluginProvider;
let oldStart;
let pluginStart;
let oldState;
let pluginState;
try {
  const oldDir = await mkdtemp(path.join(cwd, 'old-session-'));
  const pluginDir = await mkdtemp(path.join(cwd, 'plugin-session-'));
  oldProvider = spawnProvider('old', 'src-tauri/pi-sdk-host.mjs', oldDir);
  pluginProvider = spawnProvider('plugin', 'src-tauri/builtin-plugins/pi/pi-plugin.mjs', pluginDir);
  oldStart = await startOld(oldProvider);
  pluginStart = await startPlugin(pluginProvider);
  assert.equal(oldStart.sessionName, 'Pi parity session');
  assert.equal(pluginStart.nativeSessionId, 'fake-pi-session');

  const oldInitial = await collectState(oldProvider, 'old');
  const pluginInitial = await collectState(pluginProvider, 'plugin');
  assert.deepEqual(comparableState(oldInitial), comparableState(pluginInitial), 'initial state diverged');

  await sendTurn(oldProvider, 'old');
  await sendTurn(pluginProvider, 'plugin');
  assert.deepEqual(normalizeEvents(oldProvider).filter((event) => event.type !== 'queue.updated'), normalizeEvents(pluginProvider).filter((event) => event.type !== 'queue.updated'), 'normalized lifecycle events diverged');
  const oldQueueEvents = await sendQueuedTurn(oldProvider, 'old');
  const pluginQueueEvents = await sendQueuedTurn(pluginProvider, 'plugin');
  assert.deepEqual(normalizeEvents({ messages: oldQueueEvents }), normalizeEvents({ messages: pluginQueueEvents }), 'queue lifecycle diverged');
  const oldRetryEvents = await sendTurn(oldProvider, 'old', 'retry parity prompt', 'retry-turn');
  const pluginRetryEvents = await sendTurn(pluginProvider, 'plugin', 'retry parity prompt', 'retry-turn');
  assert.deepEqual(normalizeEvents({ messages: oldRetryEvents }), normalizeEvents({ messages: pluginRetryEvents }), 'retry lifecycle diverged');

  oldState = await collectState(oldProvider, 'old');
  pluginState = await collectState(pluginProvider, 'plugin');
  assert.deepEqual(comparableState(oldState), comparableState(pluginState), 'session/tree/model state diverged');
  const oldUser = findUserEntry(oldState.tree.tree);
  const pluginUser = findUserEntry(pluginState.tree.tree);
  assert.ok(oldUser?.id && pluginUser?.id, 'both providers must expose a navigable user entry');

  const oldNavigation = await oldRequest(oldProvider, 'navigateTree', { entryId: oldUser.id, summarize: false });
  const pluginNavigation = await pluginRequest(pluginProvider, 'operation.invoke', { agentId: 'dev.aibo.pi.agent', sessionId: 'diff-session', operationId: 'ext.dev.aibo.pi.tree', input: { action: 'navigate', entryId: pluginUser.id, summarize: false } });
  assert.equal(oldNavigation.result.cancelled, pluginNavigation.result.output.cancelled);
  assert.equal(oldNavigation.result.leafId, pluginNavigation.result.output.leafId);

  const oldCompactEvents = oldProvider.messages.length;
  const pluginCompactEvents = pluginProvider.messages.length;
  await oldRequest(oldProvider, 'compact', { instructions: 'retain parity decisions' });
  await pluginRequest(pluginProvider, 'operation.invoke', { agentId: 'dev.aibo.pi.agent', sessionId: 'diff-session', operationId: 'ext.dev.aibo.pi.compact', input: { instructions: 'retain parity decisions' } });
  assert.deepEqual(normalizeEvents({ messages: oldProvider.messages.slice(oldCompactEvents) }), normalizeEvents({ messages: pluginProvider.messages.slice(pluginCompactEvents) }), 'compaction lifecycle diverged');
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  try { await oldProvider?.client.rpcRequest('dispose'); } catch {}
  try {
    await pluginProvider?.client.rpcRequest('session.close', { agentId: 'dev.aibo.pi.agent', sessionId: 'diff-session' });
    await pluginProvider?.client.rpcRequest('aibo.shutdown');
  } catch {}
  await oldProvider?.client.close();
  await pluginProvider?.client.close();
  await rm(cwd, { recursive: true, force: true });
  await output.flush();
  const summary = {
    agent: 'pi-plugin-diff',
    probeVersion: 1,
    provider: 'same injected SDK fixture for old and plugin adapters',
    allowedDifferences,
    oldSessionId: oldStart?.sessionId ?? null,
    pluginNativeSessionId: pluginStart?.nativeSessionId ?? null,
    oldLeafId: oldState?.snapshot?.leafId ?? null,
    pluginLeafId: pluginState?.snapshot?.leafId ?? null,
    failure,
  };
  await output.writeSummary(summary);
  console.log(JSON.stringify(summary, null, 2));
}

assertProbe(!failure, failure ?? 'Pi adapter diff failed');
