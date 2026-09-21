import type { UiIconName, UiSessionControlMarkProps } from './contract';

export type SessionControlAppearance = {
  icon: UiIconName;
  tone: 'info' | 'plan' | 'write' | 'elevated' | 'neutral';
};

/** Presentation only: classify declared policy semantics, never plugin IDs or labels. */
export function sessionControlAppearance({ kind, profile }: UiSessionControlMarkProps['control']): SessionControlAppearance {
  // Full host access must remain visible even when combined with another mode.
  if (profile.filesystemPolicy === 'danger-full-access') return { icon: 'shield-alert', tone: 'elevated' };
  if (kind === 'mode') {
    if (profile.interactionMode === 'plan') return { icon: 'review', tone: 'plan' };
    if (profile.interactionMode === 'edit') return { icon: 'edit', tone: 'write' };
    if (profile.interactionMode === 'ask' || profile.filesystemPolicy === 'read-only') return { icon: 'eye', tone: 'info' };
  }
  if (profile.approvalReviewer === 'auto-review') return { icon: 'trust', tone: 'plan' };
  if (profile.approvalReviewer === 'user' || profile.commandPolicy === 'approved' || profile.approvalPolicy === 'untrusted') return { icon: 'shield-question', tone: 'info' };
  if (profile.filesystemPolicy === 'read-only') return { icon: 'eye', tone: 'info' };
  if (profile.filesystemPolicy === 'workspace-write') return { icon: 'edit', tone: 'write' };
  return { icon: 'settings', tone: 'neutral' };
}
