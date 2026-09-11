import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

const option = { reference: 'model', id: 'model', provider: null, label: 'Model', defaultReasoningEffort: 'medium',
  reasoningEfforts: ['low', 'medium', 'high'].map(id => ({ id, label: id })) };
const initialCatalog = { current: option, models: [option], currentReasoningEffort: 'high', reasoningEfforts: option.reasoningEfforts };
const session = { id: 'session', agent: 'dev.aibo.codex.agent', pluginInstallationId: 'release', capabilities: ['model.select', 'model.reasoning'] };

async function withModule(run) {
  const server = await createServer({ server: { middlewareMode: true, ws: false, watch: null }, appType: 'custom' });
  try { await run(await server.ssrLoadModule('/src/lib/app/model-configuration.ts'), server); }
  finally { await server.close(); }
}

test('plugin matrix follows confirmed reasoning through set, reread and reopen even with stale profiles', () => withModule(async ({ modelConfigurationState, createModelConfigurationService }, server) => {
  const { createAgentFacade } = await server.ssrLoadModule('/src/lib/app/agent-facade.ts');
  const calls = [];
  let catalog = structuredClone(initialCatalog);
  const staleProfile = { requested: { reasoningEffort: 'low' }, enforced: { reasoningEffort: 'low' } };
  const service = createModelConfigurationService({ getSessionExecutionProfile: async () => ({ requested: {}, enforced: {} }),
    facade: createAgentFacade({ invokeAgentCapability: async (id, capability, input) => {
      calls.push([id, capability, input]);
      if (capability === 'model.reasoning') catalog.currentReasoningEffort = input.level;
      return {};
    } }),
    getSessionModels: async () => structuredClone(catalog),
    legacyApply: () => assert.fail('bound plugins never use profile transport'),
  });
  assert.equal(modelConfigurationState(session, catalog, staleProfile).selectedReasoningEffort, 'high');
  const result = await service.apply(session, { kind: 'configuration', model: 'model', reasoningEffort: 'medium' }, catalog, staleProfile);
  assert.equal(modelConfigurationState(session, result.catalog, staleProfile).selectedReasoningEffort, 'medium');
  assert.equal(modelConfigurationState(session, structuredClone(catalog), null).selectedReasoningEffort, 'medium');
  await service.apply(session, { kind: 'configuration', model: 'model', reasoningEffort: null }, catalog, staleProfile);
  assert.equal(catalog.currentReasoningEffort, 'medium', 'preserve column does not reset reasoning');
  assert.equal(calls.filter(([, cap]) => cap === 'model.reasoning').length, 1);
  assert.equal(modelConfigurationState(session, catalog, staleProfile).defaultAction, 'preserve');
  assert.equal(modelConfigurationState(session, null, staleProfile).selectedReasoningEffort, null, 'unloaded plugin data cannot borrow an old profile');
}));

test('combined model changes validate all capabilities and levels before any mutation', () => withModule(async ({ createModelConfigurationService }) => {
  let mutations = 0;
  const service = createModelConfigurationService({ getSessionExecutionProfile: async () => ({ requested: {}, enforced: {} }), facade: { invoke: async () => { mutations++; } }, getSessionModels: async () => initialCatalog,
    legacyApply: () => assert.fail('no compatibility fallback') });
  await assert.rejects(service.apply({ ...session, capabilities: ['model.select'] }, { kind: 'configuration', model: 'model', reasoningEffort: 'high' }, initialCatalog, null), /model.reasoning/);
  await assert.rejects(service.apply(session, { kind: 'configuration', model: 'model', reasoningEffort: 'unsupported' }, initialCatalog, null), /不支持/);
  assert.equal(mutations, 0);
}));

test('bound Pi uses the capability facade and unbound Codex retains explicit default behavior', () => withModule(async ({ createModelConfigurationService, modelConfigurationState }, server) => {
  const { createLegacyModelConfiguration } = await server.ssrLoadModule('/src/lib/app/compatibility/legacy-model-configuration.ts');
  const calls = [];
  const legacyApply = createLegacyModelConfiguration({ updateSessionExecutionProfile: async (id, requested) => ({ sessionId: id, requested, enforced: requested }) });
  const service = createModelConfigurationService({ getSessionExecutionProfile: async () => ({ requested: {}, enforced: {} }), facade: { invoke: async (...args) => { calls.push(args); } }, getSessionModels: async () => initialCatalog, legacyApply });
  const piOption = { ...option, reference: 'provider/model', provider: 'provider' };
  const piCatalog = { ...initialCatalog, current: piOption, models: [piOption] };
  await service.apply({ ...session, agent: 'dev.aibo.pi.agent' }, { kind: 'configuration', model: 'provider/model', reasoningEffort: 'high' }, piCatalog, null);
  assert.deepEqual(calls[0][2], { action: 'set', provider: 'provider', modelId: 'model' });
  assert.equal(calls[1][1], 'model.reasoning');
  const legacy = { ...session, agent: 'codex', pluginInstallationId: null };
  const result = await service.apply(legacy, { kind: 'configuration', model: 'model', reasoningEffort: null }, initialCatalog, { requested: { reasoningEffort: 'high' } });
  assert.equal(result.profile.requested.reasoningEffort, null);
  assert.deepEqual(modelConfigurationState(legacy, initialCatalog, result.profile), { selectedReasoningEffort: null, currentReasoningEffort: 'high', defaultAction: 'reset' });
  await assert.rejects(service.apply({ ...legacy, agent: 'external' }, { kind: 'model', model: 'model' }, initialCatalog, null), /provider_unavailable/);
}));
