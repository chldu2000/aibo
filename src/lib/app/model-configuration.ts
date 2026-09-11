import type { SessionExecutionProfile, SessionModelCatalog } from '$lib/types';
import type { CapabilitySession, createAgentFacade } from './agent-facade';

export type ModelConfigurationChange =
  | { kind: 'model'; model: string | null }
  | { kind: 'reasoning'; reasoningEffort: string | null }
  | { kind: 'configuration'; model: string; reasoningEffort: string | null };

export type ModelConfigurationState = {
  currentReasoningEffort: string | null;
  selectedReasoningEffort: string | null;
  defaultAction: 'preserve' | 'reset';
};

/** The bound plugin owns its configuration; an old execution profile is not a fallback. */
export function modelConfigurationState(
  session: Pick<CapabilitySession, 'pluginInstallationId'> | null,
  catalog: SessionModelCatalog | null,
  profile: SessionExecutionProfile | null,
): ModelConfigurationState {
  if (session?.pluginInstallationId) {
    return {
      currentReasoningEffort: catalog?.currentReasoningEffort ?? catalog?.current?.defaultReasoningEffort ?? null,
      selectedReasoningEffort: catalog?.currentReasoningEffort ?? null,
      defaultAction: 'preserve',
    };
  }
  const requested = profile?.requested.reasoningEffort ?? null;
  return {
    currentReasoningEffort: catalog?.currentReasoningEffort ?? requested ?? catalog?.current?.defaultReasoningEffort ?? null,
    selectedReasoningEffort: requested,
    defaultAction: 'reset',
  };
}

export function createModelConfigurationService(ports: {
  facade: Pick<ReturnType<typeof createAgentFacade>, 'invoke'>;
  getSessionModels: (sessionId: string) => Promise<SessionModelCatalog>;
  getSessionExecutionProfile: (sessionId: string) => Promise<SessionExecutionProfile>;
  legacyApply: (session: CapabilitySession, change: ModelConfigurationChange, catalog: SessionModelCatalog | null,
    profile: SessionExecutionProfile | null) => Promise<SessionExecutionProfile>;
}) {
  return {
    async apply(session: CapabilitySession, change: ModelConfigurationChange,
      catalog: SessionModelCatalog | null, profile: SessionExecutionProfile | null) {
      if (!session.pluginInstallationId) {
        const updatedProfile = await ports.legacyApply(session, change, catalog, profile);
        return { catalog: await ports.getSessionModels(session.id), profile: updatedProfile };
      }
      const changesModel = change.kind !== 'reasoning';
      const level = change.kind === 'model' ? null : change.reasoningEffort;
      // Check the whole intent before the first mutation. A combined operation is not atomic.
      if (changesModel && !session.capabilities.includes('model.select')) throw new Error('capability_unsupported: model.select');
      if ((level !== null || change.kind === 'reasoning') && !session.capabilities.includes('model.reasoning')) {
        throw new Error('capability_unsupported: model.reasoning');
      }
      if (change.kind === 'reasoning' && level === null) throw new Error('此插件未提供恢复默认推理强度的能力。');
      if (changesModel && !change.model) throw new Error('此插件未提供恢复默认模型的能力。');
      const available = catalog ?? await ports.getSessionModels(session.id);
      const selected = changesModel ? available.models.find(option => option.reference === change.model) : available.current;
      if (changesModel && !selected) throw new Error('所选模型不在当前模型目录中，请刷新后重试。');
      if (level !== null && !(selected?.reasoningEfforts ?? available.reasoningEfforts).some(option => option.id === level)) {
        throw new Error('所选模型不支持此推理强度。');
      }
      if (changesModel && selected) {
        await ports.facade.invoke(session, 'model.select', selected.provider
          ? { action: 'set', provider: selected.provider, modelId: selected.id }
          : { action: 'set', reference: selected.reference });
      }
      if (level !== null) await ports.facade.invoke(session, 'model.reasoning', { action: 'set', level });
      const updatedCatalog = await ports.getSessionModels(session.id);
      return { catalog: updatedCatalog, profile: await ports.getSessionExecutionProfile(session.id) };
    },
  };
}
