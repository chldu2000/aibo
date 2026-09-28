import type { SessionExecutionProfile, SessionModelCatalog } from '$lib/types';
import type { CapabilitySession, createAgentFacade } from './agent-facade';

export type ModelConfigurationChange =
  | { kind: 'model'; model: string | null }
  | { kind: 'reasoning'; reasoningEffort: string | null }
  | { kind: 'configuration'; model: string; reasoningEffort: string | null }
  | { kind: 'serviceTier'; serviceTier: string }
  | { kind: 'contextWindow'; contextWindow: string; modelReference: string };

export type ModelConfigurationState = {
  currentReasoningEffort: string | null;
  selectedReasoningEffort: string | null;
  defaultAction: 'preserve' | 'reset';
};

/** IDs may encode model-specific parameter combinations; only labels are display text. */
export function reasoningEffortLabel(catalog: SessionModelCatalog | null, id: string | null): string | null {
  if (!id) return null;
  return [...(catalog?.current?.reasoningEfforts ?? []), ...(catalog?.reasoningEfforts ?? [])]
    .find(option => option.id === id)?.label ?? null;
}

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
}) {
  return {
    async apply(session: CapabilitySession, change: ModelConfigurationChange,
      catalog: SessionModelCatalog | null, profile: SessionExecutionProfile | null) {
      if (!session.pluginInstallationId) {
        throw new Error("history_only: old session configuration is read-only");
      }
      if (change.kind === 'contextWindow') {
        if (!session.capabilities.includes('model.context-window')) throw new Error('capability_unsupported: model.context-window');
        // Refresh before applying: the open selector may belong to an older model.
        const latest = await ports.getSessionModels(session.id);
        if (latest.current?.reference !== change.modelReference) throw new Error('当前模型已变化，请重新选择上下文大小。');
        if (!latest.current.contextWindows?.some(option => option.id === change.contextWindow)) throw new Error('当前模型不支持此上下文大小。');
        await ports.facade.invoke(session, 'model.context-window', { action: 'set', contextWindow: change.contextWindow });
        const updated = await ports.getSessionModels(session.id);
        if (updated.current?.reference !== change.modelReference || updated.currentContextWindow !== change.contextWindow) throw new Error('插件未确认所选上下文大小，请刷新模型配置。');
        return { catalog: updated, profile: await ports.getSessionExecutionProfile(session.id) };
      }
      const changesTier = change.kind === 'serviceTier';
      const changesModel = !changesTier && change.kind !== 'reasoning';
      const level = change.kind === 'model' || changesTier ? null : change.reasoningEffort;
      // Check the whole intent before the first mutation. A combined operation is not atomic.
      if (changesModel && !session.capabilities.includes('model.select')) throw new Error('capability_unsupported: model.select');
      if ((level !== null || change.kind === 'reasoning') && !session.capabilities.includes('model.reasoning')) {
        throw new Error('capability_unsupported: model.reasoning');
      }
      if (changesTier && !session.capabilities.includes('model.service-tier')) throw new Error('capability_unsupported: model.service-tier');
      if (change.kind === 'reasoning' && level === null) throw new Error('此插件未提供恢复默认推理强度的能力。');
      if (changesModel && !change.model) throw new Error('此插件未提供恢复默认模型的能力。');
      const available = !catalog || catalog.parameterScope === 'current-model'
        ? await ports.getSessionModels(session.id) : catalog;
      if (changesTier) {
        const supported = change.serviceTier === 'default'
          || available.current?.serviceTiers.some(option => option.id === change.serviceTier);
        if (!supported) throw new Error('当前模型不支持此服务层级。');
        await ports.facade.invoke(session, 'model.service-tier', { action: 'set', tier: change.serviceTier });
        return { catalog: await ports.getSessionModels(session.id), profile: await ports.getSessionExecutionProfile(session.id) };
      }
      const selected = changesModel ? available.models.find(option => option.reference === change.model) : available.current;
      if (changesModel && !selected) throw new Error('所选模型不在当前模型目录中，请刷新后重试。');
      const sequential = available.parameterScope === 'current-model';
      if (sequential && level !== null && selected?.reference !== available.current?.reference) {
        throw new Error('请先切换模型，读取该模型的推理选项后再选择强度。');
      }
      if (level !== null && !(selected?.reasoningEfforts ?? available.reasoningEfforts).some(option => option.id === level)) {
        throw new Error('所选模型不支持此推理强度。');
      }
      if (changesModel && selected && !(sequential && level !== null)) {
        await ports.facade.invoke(session, 'model.select', selected.provider
          ? { action: 'set', provider: selected.provider, modelId: selected.id }
          : { action: 'set', reference: selected.reference });
      }
      if (level !== null) await ports.facade.invoke(session, 'model.reasoning', { action: 'set', level });
      const updatedCatalog = await ports.getSessionModels(session.id);
      if (sequential && (updatedCatalog.current?.reference !== selected?.reference
        || level !== null && updatedCatalog.currentReasoningEffort !== level)) {
        throw new Error('插件未确认所选模型或推理强度，请刷新模型配置。');
      }
      return { catalog: updatedCatalog, profile: await ports.getSessionExecutionProfile(session.id) };
    },
  };
}
