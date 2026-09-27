import type { AcpTransport } from './transport.js';

export declare const BASE_CAPABILITIES: readonly string[];
export declare function pluginError(kind: string, message: string): Error & { kind: string };
export declare function object(value: unknown): Record<string, any>;
export declare function bounded(value: unknown, max?: number): string;

/** The narrow session surface extension hooks may use. */
export type AcpSessionHooks = {
  readonly label: string;
  readonly sessionId: string | null | undefined;
  readonly turnId: string | null | undefined;
  readonly subagents: Map<string, Record<string, any>>;
  event(type: string, payload: unknown, correlation?: unknown): void;
  respond(id: string | number, result: unknown): void;
  /** Registers a pending interaction; answers `cancelled` and returns false once 32 are waiting. */
  await(requestId: string, rpcId: string | number, interaction:
    | { kind: 'question'; answer(answers: unknown): unknown; [key: string]: unknown }
    | { kind: string; approve(decision: 'accept' | 'cancel'): unknown; [key: string]: unknown }): boolean;
  updateSubagent(subagent: Record<string, any>, changes?: Record<string, any>): void;
};

export type AcpExtension = {
  /** Agent name used in error messages; the transport uses `${label} ACP`. */
  label: string;
  command: string;
  args?: string[];
  clientName?: string;
  clientMeta?: Record<string, unknown>;
  /** When set, the agent must advertise it and `authenticate` runs before new/load. */
  authMethodId?: string;
  recoverySchema: string;
  /** Namespace of `extension.updated` events for unrecognized updates. */
  namespace: string;
  requestPrefix?: string;
  /** Candidate capabilities, narrowed by native negotiation. Declare user-input.respond only with a question handler. */
  capabilities?: readonly string[];
  /** Native mode that performs writes; only it may run write-authorized turns. */
  writableMode: string;
  /** All native modes that may run write-authorized turns (for example Manual and Auto); defaults to `[writableMode]`. */
  writableModes?: readonly string[];
  persistsEmptySessions?: boolean;
  validateExecutionProfile(profile: unknown, permissions: readonly string[]): { mode: string; profile: Record<string, any> };
  commandCategory?(command: Record<string, any>): string;
  parameterized?(config: Record<string, any>, result: Record<string, any>): boolean;
  /** Approval events carry `options` and replies select one by `optionId` (approval.respond option variant). */
  approvalOptions?: boolean;
  /**
   * Native options shown with a host label, optionally scoped to an ACP tool kind. An option with
   * `sessionControl` is offered even outside writable modes; the host commits that control before the
   * agent is answered, and the matching `current_mode_update` to `mode` is adopted with `profile`.
   * Any other native mode change during a turn fails the turn. `contextReset` marks options after
   * which the agent continues in a fresh context under the same native session.
   */
  approvalChoices?: readonly { optionId: string; toolKind?: string; label?: string; sessionControl?: string; contextReset?: boolean; mode?: string; profile?: Record<string, unknown> }[];
  /** The agent exposes parameters per model: claim reasoning and context-window even when the current model has none. */
  parameterizedPicker?: boolean;
  subagentFromTool?(update: Record<string, any>): { name: string; task: string; activity: string; [key: string]: unknown } | null;
  handleRequest?(session: AcpSessionHooks, message: Record<string, any>, params: Record<string, any>, requestId: string): boolean;
  handleNotification?(session: AcpSessionHooks, message: Record<string, any>): boolean;
};

export declare class AcpSession {
  constructor(options: { extension: AcpExtension; transportFactory?: (options: { cwd: string }) => AcpTransport; emit?: (event: unknown) => void; pluginVersion?: string; cancelGraceMs?: number; commandWaitMs?: number });
  readonly sessionId: string | null | undefined;
  hostToolsRegistered?: boolean;
  open(options: { mode: 'create' | 'resume'; workspaceId: string; workspacePath: string; executionProfile: unknown; recovery?: unknown; permissions: readonly string[]; mcpServers?: unknown[]; hostMcpTools?: { providerIdentifier: string; toolName: string }[] }): Promise<{ nativeSessionId: string; recovery: unknown; capabilities: string[] }>;
  prompt(options: { text: string; turnId: string; attachments?: unknown[]; additionalInstructions?: string; writable?: boolean }): Promise<{ status: 'completed' | 'interrupted' | 'failed'; recovery: unknown }>;
  cancel(): Promise<{ accepted: true }>;
  respondApproval(requestId: string, answer: 'accept' | 'cancel' | { optionId: string }): { resolved: true; recovery: unknown; capabilities: string[] };
  respondUserInput(requestId: string, answers: unknown): { resolved: true; recovery: unknown; capabilities: string[] };
  capabilities(): string[];
  commands(): Promise<{ commands: Record<string, any>[] }>;
  configure(kind: 'reasoning' | 'context', input: Record<string, any>): Promise<Record<string, any>>;
  models(input: Record<string, any>): Promise<Record<string, any>>;
  snapshot(): { nativeSessionId: string; recovery: unknown; capabilities: string[] };
  recovery(): unknown;
  close(): Promise<{ accepted: true }>;
}
