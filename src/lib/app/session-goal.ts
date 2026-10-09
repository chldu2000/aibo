import type { AgentGoal } from '$lib/types';
import { translate } from '../../../packages/i18n/index.js';
import type { Locale } from '../../../packages/i18n/index.js';

export function normalizeAgentGoal(value: Record<string, unknown>): AgentGoal | null {
  const candidate = value.goal && typeof value.goal === 'object' ? value.goal as Record<string, unknown> : value;
  const objective = typeof candidate.objective === 'string' ? candidate.objective.trim() : '';
  if (!objective) return null;
  const raw = candidate.status === 'complete' ? 'completed' : candidate.status;
  const statuses = ['active', 'paused', 'completed', 'cleared', 'blocked', 'usageLimited', 'budgetLimited'];
  const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  return {
    objective, status: statuses.includes(String(raw)) ? raw as AgentGoal['status'] : 'unknown',
    tokenBudget: number(candidate.tokenBudget), tokensUsed: number(candidate.tokensUsed), timeUsedSeconds: number(candidate.timeUsedSeconds),
    updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : typeof candidate.updatedAt === 'number' && Number.isFinite(candidate.updatedAt) ? String(candidate.updatedAt) : null,
  };
}

export function goalStatusLabel(goal: AgentGoal, running: boolean, locale: Locale = 'zh-CN'): string {
  if (goal.status === 'paused' && running) return translate(locale, 'goal.status.pausedRunning');
  if (goal.status === 'active') return translate(locale, running ? 'goal.status.activeRunning' : 'goal.status.activeIdle');
  return translate(locale, `goal.status.${goal.status}`);
}

export function goalCanResume(goal: AgentGoal | null): boolean {
  return !!goal && ['active', 'paused', 'blocked', 'usageLimited'].includes(goal.status);
}
