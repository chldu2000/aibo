import type { UsageSnapshot } from './session-usage';

export type SessionUsageCache = Record<string, UsageSnapshot>;

export function cacheSessionUsage(
  cache: SessionUsageCache,
  sessionId: string,
  usage: UsageSnapshot | null,
): SessionUsageCache {
  if (usage) return { ...cache, [sessionId]: usage };
  if (!(sessionId in cache)) return cache;
  const { [sessionId]: _removed, ...remaining } = cache;
  return remaining;
}

export function usageForSession(cache: SessionUsageCache, sessionId: string | null): UsageSnapshot | null {
  return sessionId ? cache[sessionId] ?? null : null;
}
