import type {
  AgentEvent,
  ApprovalDecision,
  ApprovalRequest,
  Session,
  TimelineItem,
} from '$lib/types';

export type AgentEventHandlerContext = {
  selectedSessionId: string | null;
  selectedAgent: Session['agent'] | null;
  timeline: TimelineItem[];
  pendingApprovals: ApprovalRequest[];
  lastSubmittedPrompt: string | null;
  updateWorkspaceSessions: (
    workspaceId: string,
    updater: (items: Session[]) => Session[],
  ) => void;
  setPendingApprovals: (approvals: ApprovalRequest[]) => void;
  setUsageSnapshot: (usage: Record<string, unknown> | null) => void;
  setTimeline: (timeline: TimelineItem[]) => void;
  setRetry: (prompt: string | null, reason: string | null) => void;
  setNotice: (notice: string) => void;
  refreshSessions: (workspaceId: string) => void | Promise<void>;
};

export function handleAgentEvent(event: AgentEvent, context: AgentEventHandlerContext): void {
  const selectedSessionId = context.selectedSessionId;
  const state = event.type === 'session.state_changed' ? event.payload.state : undefined;
  if (typeof state === 'string') {
    context.updateWorkspaceSessions(event.workspaceId, (items) =>
      items.map((session) =>
        session.id === event.sessionId ? { ...session, state: state as Session['state'] } : session,
      ),
    );
  }

  if (event.type === 'approval.requested') {
    const approval = approvalFromEvent(event);
    if (approval) {
      context.setPendingApprovals([
        ...context.pendingApprovals.filter(
          (item) => item.sessionId !== approval.sessionId || item.requestId !== approval.requestId,
        ),
        approval,
      ]);
    }
  }

  if (event.type === 'approval.resolved') {
    const requestId = payloadString(event.payload.requestId);
    if (requestId) {
      context.setPendingApprovals(
        context.pendingApprovals.filter(
          (approval) => approval.sessionId !== event.sessionId || approval.requestId !== requestId,
        ),
      );
    }
  }

  if (event.type === 'adapter.crashed' || event.type === 'turn.completed' || event.type === 'turn.failed') {
    context.setPendingApprovals(
      context.pendingApprovals.filter((approval) => approval.sessionId !== event.sessionId),
    );
  }

  if (event.type === 'adapter.crashed' && event.sessionId === selectedSessionId) {
    const discarded =
      typeof event.payload.pendingApprovalCount === 'number'
        ? event.payload.pendingApprovalCount
        : 0;
    const agentLabel = context.selectedAgent === 'pi' ? 'Pi' : 'Codex';
    context.setNotice(
      discarded > 0
        ? `${agentLabel} 进程已退出，${discarded} 个待审批请求已清除；请重新发送。`
        : `${agentLabel} 进程已退出，会话已中断；可重新发送以恢复。`,
    );
    context.setRetry(
      latestUserPrompt(context.timeline, context.lastSubmittedPrompt, event.turnId),
      stringPayload(event.payload.reason) ?? 'Agent 进程异常退出',
    );
  }

  if (event.sessionId === selectedSessionId && event.type === 'usage.updated') {
    const usage = event.payload.usage;
    context.setUsageSnapshot(
      usage && typeof usage === 'object' && !Array.isArray(usage)
        ? (usage as Record<string, unknown>)
        : null,
    );
  }

  if (event.sessionId === selectedSessionId && event.type === 'message.delta') {
    const externalMessageId = stringPayload(event.payload.itemId) ?? `delta:${event.eventId}`;
    const delta = stringPayload(event.payload.delta) ?? '';
    const existing = context.timeline.find((item) => item.externalMessageId === externalMessageId);
    if (existing) {
      context.setTimeline(
        context.timeline.map((item) =>
          item.id === existing.id
            ? { ...item, content: item.content + delta, status: 'streaming', updatedAt: event.occurredAt }
            : item,
        ),
      );
    } else {
      context.setTimeline([
        ...context.timeline,
        {
          id: `live:${event.eventId}`,
          sessionId: event.sessionId,
          turnId: event.turnId,
          externalMessageId,
          role: 'assistant',
          toolName: null,
          content: delta,
          status: 'streaming',
          createdAt: event.occurredAt,
          updatedAt: event.occurredAt,
        },
      ]);
    }
  }

  if (
    event.sessionId === selectedSessionId &&
    (event.type === 'tool.started' || event.type === 'tool.updated' || event.type === 'tool.completed')
  ) {
    const externalMessageId = stringPayload(event.payload.itemId) ?? `tool:${event.eventId}`;
    const toolName = stringPayload(event.payload.itemType);
    const delta = event.type === 'tool.updated' ? stringPayload(event.payload.delta) : null;
    const summary = stringPayload(event.payload.summary) ?? delta ?? '工具操作';
    const output = stringPayload(event.payload.output);
    const statusValue = stringPayload(event.payload.status);
    const status: TimelineItem['status'] =
      event.type === 'tool.completed'
        ? statusValue === 'failed' || statusValue === 'error'
          ? 'failed'
          : 'completed'
        : 'streaming';
    const existing = context.timeline.find((item) => item.externalMessageId === externalMessageId);
    if (existing) {
      context.setTimeline(
        context.timeline.map((item) =>
          item.id === existing.id
            ? {
                ...item,
                toolName: toolName ?? item.toolName,
                content: delta
                  ? item.content + delta
                  : event.type === 'tool.started' || output
                    ? output ?? summary
                    : item.content,
                status,
                updatedAt: event.occurredAt,
              }
            : item,
        ),
      );
    } else {
      context.setTimeline([
        ...context.timeline,
        {
          id: `live:${event.eventId}`,
          sessionId: event.sessionId,
          turnId: event.turnId,
          externalMessageId,
          role: 'tool',
          toolName,
          content: output ?? summary,
          status,
          createdAt: event.occurredAt,
          updatedAt: event.occurredAt,
        },
      ]);
    }
  }

  if (event.sessionId === selectedSessionId && event.type === 'turn.failed') {
    context.setRetry(
      latestUserPrompt(context.timeline, context.lastSubmittedPrompt, event.turnId),
      errorPayload(event.payload.error) ?? '本回合执行失败',
    );
  }

  if (event.type === 'message.completed' || event.type === 'turn.completed' || event.type === 'turn.failed') {
    if (
      event.type === 'turn.completed' &&
      event.payload.status !== 'failed' &&
      event.payload.status !== 'interrupted'
    ) {
      context.setRetry(null, null);
    }
    void context.refreshSessions(event.workspaceId);
  }
}

export function approvalFromEvent(event: AgentEvent): ApprovalRequest | null {
  const requestId = payloadString(event.payload.requestId);
  if (!requestId) return null;
  const availableDecisions = Array.isArray(event.payload.availableDecisions)
    ? event.payload.availableDecisions.filter(
        (decision): decision is ApprovalDecision => decision === 'accept' || decision === 'cancel',
      )
    : [];
  return {
    requestId,
    sessionId: event.sessionId,
    turnId: event.turnId,
    kind: payloadString(event.payload.kind) ?? 'approval',
    command: payloadString(event.payload.command),
    cwd: payloadString(event.payload.cwd),
    availableDecisions: availableDecisions.length > 0 ? availableDecisions : ['accept', 'cancel'],
  };
}

function stringPayload(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function payloadString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function errorPayload(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const message = record.message ?? record.error;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return null;
}

function latestUserPrompt(
  timeline: TimelineItem[],
  lastSubmittedPrompt: string | null,
  turnId: string | null,
): string | null {
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const item = timeline[index];
    if (item.role === 'user' && (!turnId || item.turnId === turnId)) return item.content;
  }
  return lastSubmittedPrompt;
}
