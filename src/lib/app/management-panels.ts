import type { ManagementPanelDeclaration } from '../../../packages/plugin-protocol/src/management';
import type { AgentSettingsTarget, AgentSettingsSnapshot, AgentSettingsSave } from '../../../packages/plugin-protocol/src/settings';
import type { CapabilityScope } from '../../../packages/plugin-protocol/src/capability';
import { createAgentSettingsController, type AgentSettingsState } from './agent-settings-controller.ts';

export type ManagementPanelEntry = {
  id: `plugin:${string}`;
  installationId: string;
  enabled: boolean;
  declaration: ManagementPanelDeclaration;
};
type Installation = {
  id: string; installed: boolean; enabled: boolean;
  contributions?: { kind: string; metadata: Record<string, unknown> }[];
};

/** Metadata has already passed the native manifest validator. No process is started. */
export function managementPanels(installations: Installation[]): ManagementPanelEntry[] {
  return installations.filter(item => item.installed).flatMap(installation =>
    (installation.contributions ?? []).filter(entry => entry.kind === 'managementPanel' && ['1.0.0', '1.1.0'].includes(String(entry.metadata.contractVersion))).map(entry => {
      const declaration = entry.metadata as unknown as ManagementPanelDeclaration;
      return { id: `plugin:${installation.id}:${declaration.id}` as const, installationId: installation.id, enabled: installation.enabled, declaration };
    }));
}

export function settingsTargetKey(target: AgentSettingsTarget): string {
  return JSON.stringify([target.installationId, target.contributionId, target.scope.kind, 'id' in target.scope ? target.scope.id : null]);
}

export function managementSettingsTargets(panel: ManagementPanelEntry | undefined, sectionId: string, selectedScope: CapabilityScope['kind'], workspaceId: string | null,
  session: { id: string; agent: string; pluginInstallationId?: string | null; archived: boolean } | null): AgentSettingsTarget[] {
  const section = panel?.declaration.sections.find(item => item.id === sectionId) ?? panel?.declaration.sections[0];
  if (!panel || !section) return [];
  const kind = section.scopes.includes(selectedScope) ? selectedScope : section.scopes[0];
  const scope: CapabilityScope | null = kind === 'application' ? {kind}
    : kind === 'workspace' && workspaceId ? {kind,id:workspaceId}
    : kind === 'session' && session && !session.archived && session.pluginInstallationId === panel.installationId ? {kind,id:session.id} : null;
  if (!scope) return [];
  const targets = (section.settingsReferences ?? []).filter(ref => ref.scopes.includes(kind) && (kind !== 'session' || ref.contributionId === session?.agent))
    .map(ref => ({installationId:panel.installationId,contributionId:ref.contributionId,scope}));
  return [...new Map(targets.map(target => [settingsTargetKey(target),target])).values()];
}

/** One controller per real settings target, shared across all panel and legacy entries. */
export function createManagementSettingsStore(ports: {
  read(target: AgentSettingsTarget): Promise<AgentSettingsSnapshot>;
  save(request: AgentSettingsSave): Promise<AgentSettingsSnapshot>;
  changed(states: Record<string, AgentSettingsState>): void;
}) {
  const controllers = new Map<string, ReturnType<typeof createAgentSettingsController>>();
  let states: Record<string, AgentSettingsState> = {};
  return {
    controller(target: AgentSettingsTarget) {
      const key = settingsTargetKey(target);
      let controller = controllers.get(key);
      if (!controller) {
        controller = createAgentSettingsController({ read: ports.read, save: ports.save, changed(state) {
          if (controllers.get(key) !== controller) return;
          states = { ...states, [key]: state }; ports.changed(states);
        } });
        controllers.set(key, controller);
      }
      return controller;
    },
    retain(installationIds: string[]) {
      for (const key of controllers.keys()) {
        const target = states[key]?.target;
        if (target && !installationIds.includes(target.installationId)) {
          controllers.delete(key); delete states[key];
        }
      }
      ports.changed({ ...states });
    },
  };
}
