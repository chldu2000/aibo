import type { ExecutionProfile, SessionControl, SessionExecutionProfile } from '$lib/types';

export function sessionControlOptions(profile: SessionExecutionProfile | null, sessionId: string | null): SessionControl[] {
  return sessionId && profile?.sessionId === sessionId ? profile.sessionControls ?? [] : [];
}

export function selectedSessionControls(options: readonly SessionControl[], current?: ExecutionProfile | null): SessionControl[] {
  if (!current) return [];
  const selected = new Set<string>();
  return options.filter(option => {
    if (selected.has(option.kind) || !Object.entries(option.profile).every(([key, value]) => current[key as keyof ExecutionProfile] === value)) return false;
    selected.add(option.kind);
    return true;
  });
}
