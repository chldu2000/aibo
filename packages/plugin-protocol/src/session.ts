import type { JsonValue } from './semantic.js';

/** Session identity comes from CapabilityInvocation.scope, never plugin input. */
export const SESSION_CAPABILITY_VERSION = '1.0.0';
export type SessionOpenInput = {
  mode:'create'|'resume';
  executionProfile:{schema?:string;interactionMode?:'ask'|'plan'|'edit';approvalPolicy?:string;approvalReviewer?:string;filesystemPolicy?:string;commandPolicy?:string;networkPolicy?:string;model?:string|null;reasoningEffort?:string|null};
  recovery?:Record<string,JsonValue>|null;
};
export type SessionOpenOutput = {nativeSessionId:string;recovery:Record<string,JsonValue>;capabilities:string[]};
export type SessionTurnInput = {text:string;attachments?:Record<string,JsonValue>[]};
export type SessionTurnOutput = {status:'completed'|'interrupted'|'failed';recovery:Record<string,JsonValue>|null};
export type SessionToolResponse = {requestId:string;result:JsonValue;error?:never}|{requestId:string;error:string;result?:never};
export type SessionDomainEvent = {
  nativeSessionId:string;turnId:string|null;type:string;
  correlation:Record<string,JsonValue>|null;payload:Record<string,JsonValue>;
};

/** Declarative controls offered by a session contribution, never an authority grant. */
export interface SessionControl {
  id: string;
  kind: 'permission' | 'mode';
  label: string;
  description: string;
  command?: string;
  profile: {
    interactionMode?: 'ask' | 'plan' | 'edit';
    approvalPolicy?: 'never' | 'untrusted' | 'on-request' | 'trusted';
    approvalReviewer?: 'user' | 'auto-review' | 'none';
    filesystemPolicy?: 'read-only' | 'workspace-write' | 'danger-full-access';
    commandPolicy?: 'disabled' | 'approved' | 'trusted';
    networkPolicy?: 'disabled' | 'agent-managed';
  };
}
