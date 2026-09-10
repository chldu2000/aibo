import type { PiSessionTreeNavigation, PiSessionTreeSnapshot, PiTreeNavigationOptions } from '$lib/types';
import type { CapabilityInput, CapabilitySession } from '../agent-facade';

/** Historical Pi tree transport. Remove when legacy unbound sessions are retired. */
export function legacyTreeCapability(ports: {
  getPiSessionTree?: (sessionId: string) => Promise<PiSessionTreeSnapshot>;
  navigatePiSessionTree?: (sessionId: string, entryId: string, options: PiTreeNavigationOptions) => Promise<PiSessionTreeNavigation>;
}) {
  return async (session: CapabilitySession, capability: string, input: CapabilityInput): Promise<CapabilityInput> => {
    if (session.agent !== 'pi' || session.pluginInstallationId || capability !== 'session.tree') {
      throw new Error('provider_unavailable: no compatible legacy binding');
    }
    if (input.action === 'get' && ports.getPiSessionTree) return { ...await ports.getPiSessionTree(session.id) };
    if (input.action === 'navigate' && typeof input.entryId === 'string' && ports.navigatePiSessionTree) {
      return { ...await ports.navigatePiSessionTree(session.id, input.entryId, {
        mode: input.summarize ? (typeof input.customInstructions === 'string' ? 'custom' : 'summary') : 'none',
        customInstructions: typeof input.customInstructions === 'string' ? input.customInstructions : undefined,
      }) };
    }
    throw new Error('capability_unsupported: legacy tree operation');
  };
}
