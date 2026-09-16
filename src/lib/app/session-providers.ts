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

/** Existing sessions retain their release's identity even when that release is disabled. */
export function sessionProviderIcon(installations: SessionProviderInstallation[], session: { agent: string; pluginInstallationId?: string | null }): AgentIcon | undefined {
  const installation = installations.find(item => item.id === session.pluginInstallationId);
  return installation ? sessionProviders(installation).find(provider => provider.id === session.agent)?.icon : undefined;
}
