import type { ExecutionProfile, SessionAccessMode } from '$lib/types';
import type { AgentKind } from './agent-kind';

export function sessionAccessProfile(
  agent: AgentKind,
  mode: SessionAccessMode,
  current?: ExecutionProfile | null,
): ExecutionProfile {
  const profile = current ?? {
    schema: 'aibo.execution-profile/v1',
    interactionMode: 'ask',
    approvalPolicy: agent === 'codex' ? 'on-request' : 'never',
    approvalReviewer: agent === 'codex' ? 'user' : 'none',
    filesystemPolicy: 'read-only',
    commandPolicy: agent === 'codex' ? 'approved' : 'disabled',
    networkPolicy: 'disabled',
    model: null,
    reasoningEffort: null,
  } satisfies ExecutionProfile;

  if (agent === 'codex') {
    if (mode === 'full-access') return { ...profile, interactionMode: 'edit', approvalPolicy: 'never', approvalReviewer: 'none', filesystemPolicy: 'danger-full-access', commandPolicy: 'trusted', networkPolicy: 'agent-managed' };
    if (mode === 'approve-for-me') return { ...profile, interactionMode: 'edit', approvalPolicy: 'on-request', approvalReviewer: 'auto-review', filesystemPolicy: 'workspace-write', commandPolicy: 'trusted', networkPolicy: 'disabled' };
    return { ...profile, interactionMode: 'ask', approvalPolicy: 'on-request', approvalReviewer: 'user', filesystemPolicy: 'workspace-write', commandPolicy: 'approved', networkPolicy: 'disabled' };
  }
  if (mode === 'workspace-write') return { ...profile, interactionMode: 'edit', approvalPolicy: 'on-request', approvalReviewer: 'user', filesystemPolicy: 'workspace-write', commandPolicy: 'approved' };
  if (mode === 'plan') return { ...profile, interactionMode: 'plan', approvalPolicy: 'never', approvalReviewer: 'none', filesystemPolicy: 'read-only', commandPolicy: 'disabled' };
  return { ...profile, interactionMode: 'ask', approvalPolicy: 'never', approvalReviewer: 'none', filesystemPolicy: 'read-only', commandPolicy: 'disabled' };
}
