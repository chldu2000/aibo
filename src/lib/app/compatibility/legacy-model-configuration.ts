import type { ExecutionProfile, SessionExecutionProfile, SessionModelCatalog } from '$lib/types';
import type { CapabilitySession } from '../agent-facade';
import type { ModelConfigurationChange } from '../model-configuration';

/** Remove after unbound Codex sessions have migrated or become history-only. */
export function createLegacyModelConfiguration(ports: {
  updateSessionExecutionProfile: (sessionId: string, profile: ExecutionProfile) => Promise<SessionExecutionProfile>;
}) {
  return async (session: CapabilitySession, change: ModelConfigurationChange,
    catalog: SessionModelCatalog | null, profile: SessionExecutionProfile | null) => {
    if (session.pluginInstallationId || session.agent !== 'codex') {
      throw new Error('provider_unavailable: unbound session has no supported model configuration runtime');
    }
    if (!profile) throw new Error('当前会话配置尚未加载，请稍候重试。');
    const requested = { ...profile.requested };
    if (change.kind !== 'reasoning') requested.model = change.model;
    if (change.kind !== 'model') requested.reasoningEffort = change.reasoningEffort;
    else {
      const selected = change.model ? catalog?.models.find(option => option.reference === change.model)
        : catalog?.models.find(option => option.isDefault);
      if (selected?.reasoningEfforts.length && !selected.reasoningEfforts.some(option => option.id === requested.reasoningEffort)) {
        requested.reasoningEffort = selected.defaultReasoningEffort ?? selected.reasoningEfforts[0]?.id ?? null;
      }
    }
    return ports.updateSessionExecutionProfile(session.id, requested);
  };
}
