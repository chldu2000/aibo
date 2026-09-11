import type { AgentCommand } from '$lib/types';
import type { CapabilitySession, CapabilityInput } from '../agent-facade';
/** Existing native sessions only; remove when their runtime paths are retired. */
export function legacyCapability(ports: {
  getCodexGoal(id: string): Promise<CapabilityInput>;
  setCodexGoal(id: string, objective: string): Promise<CapabilityInput>;
  clearCodexGoal(id: string): Promise<CapabilityInput>;
  listCodexSkills(id: string): Promise<AgentCommand[]>;
  listPiCommands(id: string): Promise<AgentCommand[]>;
}) {
  return async (session: CapabilitySession, capability: string, input: CapabilityInput): Promise<CapabilityInput> => {
    if (session.pluginInstallationId) throw new Error('invalid_session: expected legacy session');
    if (session.agent === 'codex') {
      if (capability === 'skill.list') return { skills: await ports.listCodexSkills(session.id) };
      if (capability === 'goal.manage') {
        if (input.action === 'get') return ports.getCodexGoal(session.id);
        if (input.action === 'clear') return ports.clearCodexGoal(session.id);
        if (input.action === 'set' && typeof input.objective === 'string') return ports.setCodexGoal(session.id, input.objective);
      }
    }
    if (session.agent === 'pi' && capability === 'command.list') return { commands: await ports.listPiCommands(session.id) };
    throw new Error('provider_unavailable: no compatible legacy capability');
  };
}
