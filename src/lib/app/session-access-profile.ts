import type { ExecutionProfile, SessionAccessMode } from '$lib/types';

export function sessionAccessProfile(
  availableModes: readonly SessionAccessMode[],
  mode: SessionAccessMode,
  current?: ExecutionProfile | null,
): ExecutionProfile {
  if (!availableModes.includes(mode)) throw new Error(`capability_unsupported: access mode ${mode}`);
  const profile = current ?? {
    schema: 'aibo.execution-profile/v1', interactionMode: 'ask', approvalPolicy: 'never',
    approvalReviewer: 'none', filesystemPolicy: 'read-only', commandPolicy: 'disabled',
    networkPolicy: 'disabled', model: null, reasoningEffort: null,
  } satisfies ExecutionProfile;
  if (mode === 'full-access') return { ...profile, interactionMode: 'edit', approvalPolicy: 'never', approvalReviewer: 'none', filesystemPolicy: 'danger-full-access', commandPolicy: 'trusted', networkPolicy: 'agent-managed' };
  if (mode === 'approve-for-me') return { ...profile, interactionMode: 'edit', approvalPolicy: 'on-request', approvalReviewer: 'auto-review', filesystemPolicy: 'workspace-write', commandPolicy: 'trusted', networkPolicy: 'disabled' };
  if (mode === 'ask-for-approval') return { ...profile, interactionMode: 'ask', approvalPolicy: 'on-request', approvalReviewer: 'user', filesystemPolicy: 'workspace-write', commandPolicy: 'approved', networkPolicy: 'disabled' };
  if (mode === 'workspace-write') return { ...profile, interactionMode: 'edit', approvalPolicy: 'on-request', approvalReviewer: 'user', filesystemPolicy: 'workspace-write', commandPolicy: 'approved', networkPolicy: 'disabled' };
  if (mode === 'plan') return { ...profile, interactionMode: 'plan', approvalPolicy: 'never', approvalReviewer: 'none', filesystemPolicy: 'read-only', commandPolicy: 'disabled', networkPolicy: 'disabled' };
  return { ...profile, interactionMode: 'ask', approvalPolicy: 'never', approvalReviewer: 'none', filesystemPolicy: 'read-only', commandPolicy: 'disabled', networkPolicy: 'disabled' };
}
