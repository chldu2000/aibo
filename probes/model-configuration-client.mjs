import '/src/app.css';
import { language } from '/src/lib/i18n/runtime.ts';
language.set({preference:'zh-CN',locale:'zh-CN'});
import { mount, unmount } from 'svelte';
import { get } from 'svelte/store';
import Composer from '/src/lib/components/app/Composer.svelte';
import { setUiKit, setUiTheme, activeThemeStyle } from '/src/lib/ui-kit/registry.ts';
import { createAgentFacade } from '/src/lib/app/agent-facade.ts';
import { createModelConfigurationService, modelConfigurationState } from '/src/lib/app/model-configuration.ts';
const option = { reference: 'model', id: 'model', provider: null, label: 'Test Model', isDefault: true, defaultReasoningEffort: 'medium', reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].map(id => ({ id, label: id })) };
const session = { id: 'codex-plugin-session', agent: 'dev.aibo.codex.agent', pluginInstallationId: 'release', capabilities: ['model.select', 'model.reasoning'] };
const staleProfile = { sessionId: session.id, sessionControls: [{ id: 'approval', kind: 'permission', label: 'Approve', description: 'Approval required', profile: {} }], requested: { reasoningEffort: null }, enforced: { reasoningEffort: null } };
let catalog = { models: [option, ...Array.from({length:11},(_,i)=>({...option,reference:`model-${i}`,id:`model-${i}`,label:`Additional Model ${i}`,isDefault:false}))], current: option, currentReasoningEffort: 'high', reasoningEfforts: option.reasoningEfforts };
let component, kit = 'material3', theme = 'light';
const calls = [];
const service = createModelConfigurationService({
  getSessionExecutionProfile: async () => staleProfile,
  facade: createAgentFacade({ invokeAgentCapability: async (id, capability, input) => {
    calls.push({ id, capability, input });
    if (capability === 'model.reasoning') catalog.currentReasoningEffort = input.level;
    return {};
  } }),
  getSessionModels: async () => structuredClone(catalog),
  legacyApply: () => { throw new Error('unexpected legacy route'); },
});
window.modelProbe = {
  calls,
  async render(nextKit = kit, nextTheme = theme) {
    theme = nextTheme;
    kit = nextKit;
    if (component) await unmount(component);
    setUiKit(kit); setUiTheme(theme);
    document.body.classList.add('app-shell');
    document.body.dataset.uiKit = kit;
    document.body.style.cssText = get(activeThemeStyle) + ';display:block;padding:220px 32px 32px';
    component = mount(Composer, { target: document.getElementById('probe'), props: {
      selectedAgent: 'codex', selectedSession: true, sessionCapabilities: session.capabilities, selectedSessionId: session.id,
      sessionArchived: false, sessionRunning: false, selectedSessionArchiving: false, busy: false,
      attachments: [], executionProfile: staleProfile, modelCatalog: catalog, modelCatalogLoading: false,
      modelConfiguration: modelConfigurationState(session, catalog, staleProfile),
      workspacePathSuggestions: [], agentCommands: [], agentCommandsLoading: false,
      onAddAttachments() {}, onAddDirectory() {}, onRemoveAttachment() {}, onSend() {}, onQueue() {}, onAbort() {},
      onSelectAccess() {}, onLoadModels() {}, onComposerInput() {}, onSelectWorkspacePath() {},
      async onSelectModelConfiguration(model, reasoningEffort) {
        const result = await service.apply(session, { kind: 'configuration', model, reasoningEffort }, catalog, staleProfile);
        catalog = result.catalog;
        await window.modelProbe.render();
      },
    } });
  },
};
await window.modelProbe.render();
