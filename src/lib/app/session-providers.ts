import { readAgentIcon, type AgentIcon } from '../../../packages/plugin-protocol/src/agent-icon.ts';

type Contributions = {
  contributions?: { id: string; kind: string; scope: string; metadata: Record<string, unknown> }[];
};
export type SessionProviderInstallation = Contributions & {
  id: string;
  installed: boolean;
  enabled: boolean;
  runnable: boolean;
  activationIssues?: string[];
  packageDependencies?: { unavailableContributions: string[] };
};
export type SessionProviderChoice = { id: string; installationId: string; contributionId: string; label: string; icon?: AgentIcon };

/** Session creation is discovered from capability contracts, never legacy Agent metadata. */
export function sessionProviders(installation: Contributions): { id: string; displayName: string; icon?: AgentIcon }[] {
  return (installation.contributions ?? []).flatMap(contribution => {
    if (contribution.kind !== 'capabilityProvider' || contribution.scope !== 'session') return [];
    const operations = contribution.metadata.operations;
    if (!Array.isArray(operations) || !operations.some(operation => operation?.capability?.id === 'aibo.session.open')) return [];
    const icon = readAgentIcon(contribution.metadata.icon);
    return [{ id: contribution.id, displayName: typeof contribution.metadata.displayName === 'string' ? contribution.metadata.displayName : contribution.id, ...(icon ? { icon } : {}) }];
  });
}

export function readySessionProviders(installations: SessionProviderInstallation[]): SessionProviderChoice[] {
  return installations.flatMap(installation => {
    if (!installation.installed || !installation.enabled || !installation.runnable || installation.activationIssues?.length) return [];
    return sessionProviders(installation)
      .filter(provider => !installation.packageDependencies?.unavailableContributions.includes(provider.id))
      .map(provider => ({ id: JSON.stringify([installation.id, provider.id]), installationId: installation.id,
        contributionId: provider.id, label: provider.displayName, ...(provider.icon ? { icon: provider.icon } : {}) }));
  });
}

/**
 * Display identity of an existing session's provider, as declared by its plugin.
 * Falls back to the contribution ID when the installation or declaration is gone.
 */
export function sessionProviderInfo(installations: SessionProviderInstallation[], session: { agent: string; pluginInstallationId?: string | null }): { label: string; icon?: AgentIcon } {
  const installation = installations.find(item => item.id === session.pluginInstallationId);
  const provider = installation ? sessionProviders(installation).find(item => item.id === session.agent) : undefined;
  return provider ? { label: provider.displayName, ...(provider.icon ? { icon: provider.icon } : {}) } : { label: session.agent };
}

/** Existing sessions retain their release's identity even when that release is disabled. */
export function sessionProviderIcon(installations: SessionProviderInstallation[], session: { agent: string; pluginInstallationId?: string | null }): AgentIcon | undefined {
  const installation = installations.find(item => item.id === session.pluginInstallationId);
  return installation ? sessionProviders(installation).find(provider => provider.id === session.agent)?.icon : undefined;
}

/** Includes installed but unavailable choices for the host chooser; creation still uses readySessionProviders. */
export function sessionProviderChoices(installations: SessionProviderInstallation[]): (SessionProviderChoice & { unavailableReason?: string })[] {
  const ready = new Set(readySessionProviders(installations).map(choice => choice.id));
  return installations.filter(installation => installation.installed).flatMap(installation =>
    sessionProviders(installation).map(provider => {
      const id = JSON.stringify([installation.id, provider.id]);
      return { id, installationId: installation.id, contributionId: provider.id, label: provider.displayName, icon: provider.icon,
        ...(!ready.has(id) ? { unavailableReason: !installation.enabled ? '未启用' : installation.activationIssues?.length ? '运行环境不可用' : '缺少运行依赖' } : {}) };
    }),
  );
}
