import type { Session } from '$lib/types';

export type CapabilitySession = Pick<Session, 'id' | 'agent' | 'pluginInstallationId' | 'capabilities'>;
export type CapabilityInput = Record<string, unknown>;
export type CapabilityPort = (sessionId: string, capability: string, input: CapabilityInput) => Promise<CapabilityInput>;

/** Binding selects the transport; capability selects the operation, never the provider. */
export function createAgentFacade(ports: {
  invokeAgentCapability: CapabilityPort;
  legacyCapability?: (session: CapabilitySession, capability: string, input: CapabilityInput) => Promise<CapabilityInput>;
}) {
  return {
    async invoke(session: CapabilitySession, capability: string, input: CapabilityInput = {}): Promise<CapabilityInput> {
      if (!session.capabilities.includes(capability)) {
        throw new Error(`capability_unsupported: ${capability}`);
      }
      if (session.pluginInstallationId) {
        return ports.invokeAgentCapability(session.id, capability, input);
      }
      if (ports.legacyCapability) return ports.legacyCapability(session, capability, input);
      throw new Error('provider_unavailable: session has no plugin binding');
    },
  };
}
