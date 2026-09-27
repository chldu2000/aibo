import type { AcpExtension, AcpSession } from './session.js';

export declare const ACP_AGENT_SCHEMA: 'aibo.acp-agent/v1';
/** Contents of a configuration-only plugin's `acp.json`. */
export type AcpAgentConfig = {
  schema: 'aibo.acp-agent/v1';
  label: string;
  /** Must name an `executable` entry of plugin.json `executableDependencies`. */
  command: string;
  args?: string[];
  /** Native mode IDs for host interaction modes; `edit` is the write mode. */
  modes: { ask?: string; plan?: string; edit?: string };
  authMethodId?: string;
  clientMeta?: Record<string, unknown>;
  persistsEmptySessions?: boolean;
  requestPrefix?: string;
};
export declare function acpAgentConfig(config: unknown, manifest: Record<string, any>): AcpAgentConfig & { args: string[] };
export declare function agentManagedProfile(label: string, modes: AcpAgentConfig['modes']): AcpExtension['validateExecutionProfile'];
export declare function extensionFromConfig(config: AcpAgentConfig & { args: string[] }, manifest: Record<string, any>): AcpExtension;
export declare function settingsInstructions(label: string): (settings: unknown) => string;
export declare function serveAcpAgent(options: { manifestUrl: URL; configUrl?: URL; extension?: AcpExtension; additionalInstructions?: (settings: unknown) => string }): AcpSession;
