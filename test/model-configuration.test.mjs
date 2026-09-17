import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

const option = { reference: 'model', id: 'model', provider: null, label: 'Model', defaultReasoningEffort: 'medium',
  reasoningEfforts: ['low', 'medium', 'high'].map(id => ({ id, label: id })), serviceTiers: [{id:'priority',label:'Fast',description:null}] };
const initialCatalog = { current: option, models: [option], currentReasoningEffort: 'high', reasoningEfforts: option.reasoningEfforts, currentServiceTier:null };
const session = { id: 'session', agent: 'dev.aibo.codex.agent', pluginInstallationId: 'release', capabilities: ['model.select', 'model.reasoning', 'model.service-tier'] };

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

test('service tier changes use an independent capability and reject unsupported tiers', () => withModule(async ({ createModelConfigurationService }) => {
  const calls = [];
  let catalog = structuredClone(initialCatalog);
  const service = createModelConfigurationService({ getSessionExecutionProfile: async () => ({ requested: {}, enforced: {} }),
    facade: { invoke: async (_session, capability, input) => { calls.push([capability,input]); if(capability==='model.service-tier')catalog.currentServiceTier=input.tier; } },
    getSessionModels: async () => structuredClone(catalog) });
  const result = await service.apply(session,{kind:'serviceTier',serviceTier:'priority'},catalog,null);
  assert.equal(result.catalog.currentServiceTier,'priority');
  assert.deepEqual(calls,[['model.service-tier',{action:'set',tier:'priority'}]]);
  await assert.rejects(service.apply(session,{kind:'serviceTier',serviceTier:'ultrafast'},catalog,null),/不支持/);
  await assert.rejects(service.apply({...session,capabilities:['model.select']},{kind:'serviceTier',serviceTier:'priority'},catalog,null),/model.service-tier/);
}));

test('combined model changes validate all capabilities and levels before any mutation', () => withModule(async ({ createModelConfigurationService }) => {
  let mutations = 0;
  const service = createModelConfigurationService({ getSessionExecutionProfile: async () => ({ requested: {}, enforced: {} }), facade: { invoke: async () => { mutations++; } }, getSessionModels: async () => initialCatalog,
    legacyApply: () => assert.fail('no compatibility fallback') });
  await assert.rejects(service.apply({ ...session, capabilities: ['model.select'] }, { kind: 'configuration', model: 'model', reasoningEffort: 'high' }, initialCatalog, null), /model.reasoning/);
  await assert.rejects(service.apply(session, { kind: 'configuration', model: 'model', reasoningEffort: 'unsupported' }, initialCatalog, null), /不支持/);
  assert.equal(mutations, 0);
}));

test('bound Pi uses the capability facade and unbound sessions reject configuration changes', () => withModule(async ({ createModelConfigurationService, modelConfigurationState }, server) => {
  const calls = [];
  const legacyApply = () => assert.fail("history must not change execution profiles");
  const service = createModelConfigurationService({ getSessionExecutionProfile: async () => ({ requested: {}, enforced: {} }), facade: { invoke: async (...args) => { calls.push(args); } }, getSessionModels: async () => initialCatalog, legacyApply });
  const piOption = { ...option, reference: 'provider/model', provider: 'provider' };
  const piCatalog = { ...initialCatalog, current: piOption, models: [piOption] };
  await service.apply({ ...session, agent: 'dev.aibo.pi.agent' }, { kind: 'configuration', model: 'provider/model', reasoningEffort: 'high' }, piCatalog, null);
  assert.deepEqual(calls[0][2], { action: 'set', provider: 'provider', modelId: 'model' });
  assert.equal(calls[1][1], 'model.reasoning');
  const legacy = { ...session, agent: 'codex', pluginInstallationId: null };
  await assert.rejects(service.apply(legacy, { kind: "configuration", model: "model", reasoningEffort: null }, initialCatalog, { requested: { reasoningEffort: "high" } }), /history_only/);
  await assert.rejects(service.apply({ ...legacy, agent: 'external' }, { kind: 'model', model: 'model' }, initialCatalog, null), /history_only/);
}));


test('context windows use a separate capability, revalidate the model, and require backend confirmation', () => withModule(async ({ createModelConfigurationService }) => {
  const calls = [];
  const windows = [{ id: 'standard', label: '128K', tokens: 128000 }, { id: 'long', label: '1M', tokens: 1000000 }];
  let catalog = { ...initialCatalog, current: { ...option, contextWindows: windows }, currentContextWindow: 'standard' };
  const capable = { ...session, capabilities: [...session.capabilities, 'model.context-window'] };
  let fail = false, confirm = true;
  const service = createModelConfigurationService({ getSessionModels: async () => structuredClone(catalog), getSessionExecutionProfile: async () => null,
    facade: { invoke: async (_session, capability, input) => { calls.push([capability, input]); if (fail) throw Error('Backend rejected context'); if (confirm) catalog.currentContextWindow = input.contextWindow; } } });
  const change = { kind: 'contextWindow', contextWindow: 'long', modelReference: 'model' };
  const result = await service.apply(capable, change, initialCatalog, null);
  assert.equal(result.catalog.currentContextWindow, 'long');
  assert.deepEqual(calls, [['model.context-window', { action: 'set', contextWindow: 'long' }]]);
  assert.equal(result.catalog.currentReasoningEffort, 'high');
  assert.equal(result.catalog.currentServiceTier, null);
  await assert.rejects(service.apply(session, change, catalog, null), /model.context-window/);
  await assert.rejects(service.apply(capable, { ...change, contextWindow: 'invented' }, catalog, null), /不支持/);
  await assert.rejects(service.apply(capable, { ...change, modelReference: 'previous' }, catalog, null), /模型已变化/);
  assert.equal(calls.length, 1);
  fail = true;
  await assert.rejects(service.apply(capable, change, catalog, null), /Backend rejected/);
  fail = false; confirm = false; catalog.currentContextWindow = 'standard';
  await assert.rejects(service.apply(capable, change, catalog, null), /未确认/);
  assert.equal(catalog.currentContextWindow, 'standard');
  catalog = { ...catalog, current: { ...option, contextWindows: [] } };
  await assert.rejects(service.apply(capable, change, catalog, null), /不支持/);
}));
