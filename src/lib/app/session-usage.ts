export type UsageSnapshot = Record<string, unknown>;

export type UsageLimitValue = {
  id: string;
  label: string | null;
  usedPercent: number;
  windowMinutes: number | null;
  resetsAt: number | null;
};

export type UsageValues = {
  input: number | null;
  output: number | null;
  total: number | null;
  contextUsed: number | null;
  contextLimit: number | null;
  contextEstimated: boolean;
  plan: string | null;
  limits: UsageLimitValue[];
  credits: { balance: string | null; unlimited: boolean } | null;
};

export function readUsageValue(snapshot: UsageSnapshot | null | undefined, key: 'input' | 'output' | 'total'): number | null {
  if (!snapshot) return null;
  const total = snapshot.total;
  if (key === 'total') {
    if (typeof snapshot.totalTokens === 'number') return snapshot.totalTokens;
    if (total && typeof total === 'object' && !Array.isArray(total)) {
      const value = (total as Record<string, unknown>).totalTokens;
      if (typeof value === 'number') return value;
    }
    return typeof total === 'number' ? total : null;
  }
  if (typeof snapshot[key] === 'number') return snapshot[key] as number;
  if (total && typeof total === 'object' && !Array.isArray(total)) {
    const value = (total as Record<string, unknown>)[`${key}Tokens`];
    if (typeof value === 'number') return value;
  }
  return null;
}

export function toUsageValues(snapshot: UsageSnapshot | null | undefined): UsageValues | null {
  if (!snapshot) return null;
  const explicitContext = firstNumber(snapshot, ['contextTokens', 'contextUsedTokens', 'usedContextTokens']);
  const lastContext = numberFromRecord(snapshot.last, 'totalTokens');
  const contextLimit = firstNumber(snapshot, ['contextWindow', 'contextLimit', 'modelContextWindow']);
  return {
    input: readUsageValue(snapshot, 'input'), output: readUsageValue(snapshot, 'output'), total: readUsageValue(snapshot, 'total'),
    contextUsed: explicitContext ?? lastContext ?? readUsageValue(snapshot, 'input'), contextLimit,
    contextEstimated: explicitContext === null && lastContext === null,
    plan: typeof snapshot.plan === 'string' ? snapshot.plan : null,
    limits: readUsageLimits(snapshot.limits), credits: readCredits(snapshot.credits),
  };
}

function readUsageLimits(value: unknown): UsageLimitValue[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const usedPercent = finiteNumber(record.usedPercent);
    if (usedPercent === null) return [];
    return [{ id: typeof record.id === 'string' && record.id ? record.id : `limit-${index}`,
      label: typeof record.label === 'string' && record.label ? record.label : null,
      usedPercent: Math.min(100, Math.max(0, usedPercent)), windowMinutes: finiteNumber(record.windowMinutes), resetsAt: finiteNumber(record.resetsAt) }];
  });
}

function readCredits(value: unknown): UsageValues['credits'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.unlimited !== 'boolean' && typeof record.balance !== 'string') return null;
  return { balance: typeof record.balance === 'string' ? record.balance : null, unlimited: record.unlimited === true };
}

function firstNumber(snapshot: UsageSnapshot, keys: string[]): number | null {
  for (const key of keys) { const value = snapshot[key]; if (typeof value === 'number' && Number.isFinite(value)) return value; }
  const total = snapshot.total;
  if (total && typeof total === 'object' && !Array.isArray(total)) {
    for (const key of keys) { const value = (total as Record<string, unknown>)[key]; if (typeof value === 'number' && Number.isFinite(value)) return value; }
  }
  return null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function numberFromRecord(value: unknown, key: string): number | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return finiteNumber((value as Record<string, unknown>)[key]);
}
