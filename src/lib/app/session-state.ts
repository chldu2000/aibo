import type { SessionState } from '$lib/types';

export type SessionStateView = {
  state: SessionState;
  archived?: boolean;
};

export function isSessionRunning(session: SessionStateView | null | undefined): boolean {
  return session?.state === 'running' || session?.state === 'waiting_approval';
}
