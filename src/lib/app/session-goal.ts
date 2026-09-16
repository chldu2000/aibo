import type { AgentGoal } from '$lib/types';

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

export function goalStatusLabel(goal: AgentGoal, running: boolean): string {
  if (goal.status === 'paused' && running) return '目标已暂停，当前回合尚未结束';
  if (goal.status === 'active') return running ? '目标进行中' : '目标待继续';
  return {paused: '目标已暂停', completed: '目标已完成', cleared: '目标已清除', blocked: '目标受阻', usageLimited: '额度受限', budgetLimited: '目标预算已耗尽', unknown: '目标状态未知'}[goal.status];
}

export function goalCanResume(goal: AgentGoal | null): boolean {
  return !!goal && ['active', 'paused', 'blocked', 'usageLimited'].includes(goal.status);
}
