import { readNativeMessage } from './error-utils.ts';
import { localizedMessage } from '../../../packages/i18n/index.js';
import type { LocalizedText, MessageKey, MessageParams } from '../../../packages/i18n/index.js';
import type { SetNotice } from './notifications';
import { normalizeMessageQueue } from './message-queue.ts';
import { parseBackgroundTask } from '../../../packages/presentation-workbench/background-tasks.js';
import { parseSubagent } from './subagents.ts';
import type {
  AgentQueueSnapshot,
  AgentEvent,
  ApprovalDecision,
  ApprovalOption,
  ApprovalRequest,
  Session,
  TimelineItem,
  UserInputRequest,
} from '$lib/types';

export type AgentEventHandlerContext = {
  selectedSessionId: string | null;
  selectedAgent: Session['agent'] | null;
  timeline: TimelineItem[];
  pendingApprovals: ApprovalRequest[];
  pendingUserInputs: UserInputRequest[];
  lastSubmittedPrompt: string | null;
  setAgentActivity: (sessionId: string, active: boolean, label?: LocalizedText) => void;
  setContextCompacting?: (sessionId: string, compacting: boolean) => void;
  updateWorkspaceSessions: (
    workspaceId: string,
    updater: (items: Session[]) => Session[],
  ) => void;
  setPendingApprovals: (approvals: ApprovalRequest[]) => void;
  setPendingUserInputs: (requests: UserInputRequest[]) => void;
  setUsageSnapshot: (sessionId: string, usage: Record<string, unknown> | null) => void;
  setQueueSnapshot: (queue: AgentQueueSnapshot | null) => void;
  setTimeline: (timeline: TimelineItem[]) => void;
  refreshTimeline?: (sessionId: string) => void | Promise<void>;
  setRetry: (prompt: string | null, reason: LocalizedText | null) => void;
  setNotice: SetNotice;
  refreshSessions: (workspaceId: string) => void | Promise<void>;
  refreshTurnChangeSet?: (sessionId: string) => void | Promise<void>;
  refreshArtifacts?: (sessionId: string) => void | Promise<void>;
  refreshWorkspaceChanges?: (workspaceId: string) => void | Promise<void>;
  refreshExecutionProfile?: (sessionId: string) => void | Promise<void>;
};

export function eventTimelineItemId(event: Pick<AgentEvent, 'turnId'>, itemId: string | null): string | null {
  if (!itemId) return null;
  return event.turnId ? `${event.turnId}:${itemId}` : itemId;
}

export function handleAgentEvent(event: AgentEvent, context: AgentEventHandlerContext): void {
  const selectedSessionId = context.selectedSessionId;
  if (event.type === 'compaction.started') context.setContextCompacting?.(event.sessionId, true);
  if (['compaction.completed', 'turn.completed', 'turn.failed', 'adapter.crashed'].includes(event.type)) {
    context.setContextCompacting?.(event.sessionId, false);
  }
  if (event.type === 'session.state_changed') {
    context.setContextCompacting?.(event.sessionId, event.payload.state === 'compacting');
  }
  if (event.type === 'background-task.updated') {
    if (event.sessionId !== selectedSessionId) return;
    const content = JSON.stringify(event.payload);
    const task = parseBackgroundTask({toolName:'background_task',content,status:'streaming'});
    if (!task) return;
    const externalMessageId = `background:${task.id}`;
    const existing = context.timeline.find(item => item.externalMessageId === externalMessageId);
    const status: TimelineItem['status'] = task.status === 'running' ? 'streaming' : task.status === 'failed' ? 'failed' : ['unknown','stopped'].includes(task.status) ? 'interrupted' : 'completed';
    const item: TimelineItem = {...existing,id:existing?.id ?? `${event.sessionId}:background:${task.id}`,sessionId:event.sessionId,
      turnId:task.rootTurnId,externalMessageId,role:'system',toolName:'background_task',entryType:null,content,status,
      createdAt:existing?.createdAt ?? event.occurredAt,updatedAt:event.occurredAt};
    context.setTimeline(existing ? context.timeline.map(old => old === existing ? item : old) : [...context.timeline,item]);
    return;
  }
  if (event.type === 'subagent.message') return;
  if (event.type === 'subagent.updated') {
    const content = JSON.stringify(event.payload);
    const agent = parseSubagent(content);
    if (!agent || event.sessionId !== selectedSessionId) return;
    const externalMessageId = `subagent:${agent.id}`;
    const existing = context.timeline.find(item => item.externalMessageId === externalMessageId);
    const status: TimelineItem['status'] = ['pending','running','waiting'].includes(agent.status) ? 'streaming'
      : ['failed','unavailable'].includes(agent.status) ? 'failed' : agent.status === 'interrupted' ? 'interrupted' : 'completed';
    const item: TimelineItem = {...existing, id:existing?.id ?? `${event.sessionId}:subagent:${agent.id}`, sessionId:event.sessionId,
      turnId:agent.rootTurnId, externalMessageId, role:'system', toolName:'subagent', entryType:null, content, status,
      createdAt:existing?.createdAt ?? event.occurredAt, updatedAt:event.occurredAt};
    context.setTimeline(existing ? context.timeline.map(old => old === existing ? item : old) : [...context.timeline,item]);
    return;
  }

  const state = event.type === 'turn.started' ? 'running' : event.type === 'session.state_changed'
    ? event.payload.state
    : event.type === 'turn.failed'
      ? 'failed'
      : event.type === 'turn.completed'
        ? event.payload.status === 'interrupted'
          ? 'interrupted'
          : event.payload.status === 'failed'
            ? 'failed'
            : 'idle'
        : undefined;

  // A turn can spend time between two streamed items (for example, after a
  // tool completes and before Pi starts its next response). Keep that phase
  // observable instead of deriving activity only from the last timeline row.
  if (event.type === 'turn.started') {
    context.setAgentActivity(event.sessionId, true, agentMessage(event, 'activity.preparing'));
    if (event.sessionId === selectedSessionId) void context.refreshTimeline?.(event.sessionId);
  }
  if (event.type === 'message.delta') {
    context.setAgentActivity(event.sessionId, true, agentMessage(event, 'activity.generating'));
  }
  if (event.type === 'reasoning.updated') {
    context.setAgentActivity(event.sessionId, true, agentMessage(event, 'activity.thinking'));
  }
  if (event.type === 'tool.started' || event.type === 'tool.updated') {
    const tool = payloadString(event.payload.itemType) ?? payloadString(event.payload.toolName);
    context.setAgentActivity(event.sessionId, true, agentMessage(event, tool ? 'activity.executing' : 'activity.executingTool', tool ? {tool} : {}));
  }
  if (event.type === 'tool.completed') {
    const tool = payloadString(event.payload.itemType) ?? payloadString(event.payload.toolName);
    context.setAgentActivity(event.sessionId, true, agentMessage(event, tool ? 'activity.namedToolDone' : 'activity.toolDone', tool ? {tool} : {}));
  }
  if (event.type === 'approval.requested') {
    context.setAgentActivity(event.sessionId, true, agentMessage(event, 'activity.waitingApproval'));
  }
  if (event.type === 'approval.resolved') {
    const decision = payloadString(event.payload.decision);
    const tool = payloadString(event.payload.tool);
    const key = decision === 'accept' ? (tool ? 'activity.allowedTool' : 'activity.allowed') : 'activity.denied';
    context.setAgentActivity(event.sessionId, true, agentMessage(event, key, tool ? {tool} : {}));
  }
  if (event.type === 'user_input.requested') {
    context.setAgentActivity(event.sessionId, true, agentMessage(event, 'activity.waitingInput'));
  }
  if (event.type === 'user_input.resolved') {
    context.setAgentActivity(event.sessionId, true, agentMessage(event, 'activity.answerReceived'));
  }

  if (event.type === 'user_input.requested') {
    const request = userInputFromEvent(event);
    if (request) {
      context.setPendingUserInputs([
        ...context.pendingUserInputs.filter(
          (item) => item.sessionId !== request.sessionId || item.requestId !== request.requestId,
        ),
        request,
      ]);
    }
  }

  if (event.type === 'user_input.resolved') {
    const requestId = payloadString(event.payload.requestId);
    if (requestId) {
      context.setPendingUserInputs(
        context.pendingUserInputs.filter(
          (request) => request.sessionId !== event.sessionId || request.requestId !== requestId,
        ),
      );
    }
  }
  if (event.type === 'retry.started' || event.type === 'compaction.started') {
    context.setAgentActivity(event.sessionId, true, agentMessage(
      event,
      event.type === 'compaction.started' ? 'activity.compactingAgent' : 'activity.retrying',
    ));
  }
  if (event.type === 'compaction.completed') {
    const failed = event.payload.aborted === true || typeof event.payload.errorMessage === 'string';
    context.setAgentActivity(
      event.sessionId,
      event.turnId !== null,
      agentMessage(event, failed ? 'activity.compactionIncomplete' : 'activity.compactionComplete'),
    );
  }
  if (
    event.type === 'turn.completed' ||
    event.type === 'turn.failed' ||
    event.type === 'adapter.crashed' ||
    state === 'idle' ||
    state === 'failed' ||
    state === 'interrupted' ||
    state === 'closed'
  ) {
    context.setAgentActivity(event.sessionId, false);
    if (event.sessionId === selectedSessionId) {
      context.setTimeline(context.timeline.map((item) =>
        item.status === 'streaming' && (!event.turnId || item.turnId === event.turnId)
          ? { ...item, status: state === 'failed' ? 'failed' : state === 'idle' ? 'completed' : 'interrupted', updatedAt: event.occurredAt }
          : item));
    }
  }

  if (typeof state === 'string') {
    context.updateWorkspaceSessions(event.workspaceId, (items) =>
      items.map((session) =>
        session.id === event.sessionId ? { ...session, state: state as Session['state'] } : session,
      ),
    );
  }

  if (event.type === 'retry.started') {
    const agent = eventAgentLabel(event);
    const attempt = event.payload.attempt;
    context.setAgentActivity(event.sessionId, true,
      localizedMessage(typeof attempt === 'number' ? 'activity.retryAttempt' : 'activity.retryPending', {agent, ...(typeof attempt === 'number' ? {count: attempt} : {})}));
  }
  if (event.type === 'retry.completed') {
    context.setAgentActivity(event.sessionId, event.payload.success !== false);
  }

  if (event.type === 'message.completed' && event.sessionId === selectedSessionId) {
    const itemId = eventTimelineItemId(event, stringPayload(event.payload.itemId) ?? correlationString(event, 'itemId'));
    if (itemId) context.setTimeline(context.timeline.map((item) =>
      item.externalMessageId === itemId
        ? { ...item, content: stringPayload(event.payload.text) ?? item.content, status: 'completed' }
        : item));
    void context.refreshTimeline?.(event.sessionId);
  }

  if (event.type === 'adapter.warning' && event.payload.kind === 'session.binding_recovered') {
    context.updateWorkspaceSessions(event.workspaceId, (items) =>
      items.map((session) =>
        session.id === event.sessionId
          ? { ...session, externalSessionId: event.externalSessionId ?? event.nativeSessionId ?? session.externalSessionId, state: 'idle' }
          : session,
      ),
    );
    if (event.sessionId === selectedSessionId) {
      context.setNotice(localizedMessage('event.bindingRecovered'), 'warning');
    }
  }

  // The host committed a session control from an approval; the mode indicator follows the saved profile.
  if (event.type === 'session.control_changed' && event.sessionId === selectedSessionId) {
    void context.refreshExecutionProfile?.(event.sessionId);
    void context.refreshTimeline?.(event.sessionId);
    const label = stringPayload(event.payload.label);
    if (label) context.setNotice(localizedMessage(event.payload.contextReset === true ? 'event.contextReset' : 'event.controlChanged', {label}), 'success');
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

  if (event.type === 'queue.updated' && event.sessionId === selectedSessionId) {
    context.setQueueSnapshot(queueFromEvent(event));
  }

  if (event.type === 'adapter.crashed' || event.type === 'turn.completed' || event.type === 'turn.failed') {
    context.setPendingApprovals(
      context.pendingApprovals.filter((approval) => approval.sessionId !== event.sessionId),
    );
    context.setPendingUserInputs(
      context.pendingUserInputs.filter((request) => request.sessionId !== event.sessionId),
    );
  }

  if (
    (event.type === 'tool.completed' || event.type === 'turn.completed' || event.type === 'turn.failed') &&
    event.sessionId === selectedSessionId
  ) {
    void context.refreshArtifacts?.(event.sessionId);
  }

  if (event.type === 'adapter.crashed' && event.sessionId === selectedSessionId) {
    const discarded =
      typeof event.payload.pendingApprovalCount === 'number'
        ? event.payload.pendingApprovalCount
        : 0;
    const agentLabel = context.selectedAgent ?? 'Agent';
    context.setNotice(
      discarded > 0
        ? localizedMessage('event.crashedApprovals', {agent: agentLabel, count: discarded})
        : localizedMessage('event.crashed', {agent: agentLabel}), 'error',
    );
    context.setRetry(
      latestUserPrompt(context.timeline, context.lastSubmittedPrompt, event.turnId),
      readNativeMessage(event.payload.localizedReason) ?? stringPayload(event.payload.reason) ?? localizedMessage('event.retryCrashed'),
    );
  }

  if (event.type === 'adapter.crashed') context.setUsageSnapshot(event.sessionId, null);

  if (event.type === 'usage.updated') {
    const usage = event.payload.usage;
    context.setUsageSnapshot(
      event.sessionId,
      usage && typeof usage === 'object' && !Array.isArray(usage)
        ? (usage as Record<string, unknown>)
        : null,
    );
  }

  if (event.sessionId === selectedSessionId && event.type === 'compaction.completed') {
    void context.refreshTimeline?.(event.sessionId);
  }

  if (event.sessionId === selectedSessionId && event.type === 'message.delta') {
    const externalMessageId = eventTimelineItemId(
      event,
      stringPayload(event.payload.itemId) ?? correlationString(event, 'itemId') ?? 'assistant',
    )!;
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
          entryType: null,
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
    const externalMessageId = eventTimelineItemId(event, stringPayload(event.payload.itemId) ?? `tool:${event.eventId}`)!;
    const toolName = stringPayload(event.payload.itemType);
    const delta = event.type === 'tool.updated' ? stringPayload(event.payload.delta) : null;
    const summary = stringPayload(event.payload.summary) ?? delta ?? '';
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
          entryType: null,
          content: output ?? summary,
          status,
          createdAt: event.occurredAt,
          updatedAt: event.occurredAt,
        },
      ]);
    }
  }

  if (event.sessionId === selectedSessionId && (event.type === 'reasoning.updated' || event.type === 'reasoning.completed')) {
    const externalMessageId = eventTimelineItemId(event, stringPayload(event.payload.itemId) ?? `reasoning:${event.eventId}`)!;
    const delta = event.type === 'reasoning.updated' ? stringPayload(event.payload.delta) ?? '' : null;
    const summary = event.type === 'reasoning.completed' ? stringPayload(event.payload.summary) : null;
    const existing = context.timeline.find((item) => item.externalMessageId === externalMessageId);
    if (existing) {
      context.setTimeline(context.timeline.map((item) => item.id === existing.id ? {
        ...item,
        content: summary || (delta ? item.content + delta : item.content),
        status: event.type === 'reasoning.completed' ? 'completed' : 'streaming',
        updatedAt: event.occurredAt,
      } : item));
    } else if (delta || summary) {
      context.setTimeline([...context.timeline, {
        id: `live:${event.eventId}`, sessionId: event.sessionId, turnId: event.turnId,
        externalMessageId, role: 'system', toolName: 'reasoning', entryType: null,
        content: summary ?? delta ?? '', status: event.type === 'reasoning.completed' ? 'completed' : 'streaming',
        createdAt: event.occurredAt, updatedAt: event.occurredAt,
      }]);
    }
  }

  if (event.sessionId === selectedSessionId && event.type === 'turn.failed') {
    context.setRetry(
      latestUserPrompt(context.timeline, context.lastSubmittedPrompt, event.turnId),
      errorPayload(event.payload.error) ?? localizedMessage('event.retryFailed'),
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
    if (event.sessionId === selectedSessionId) {
      if (event.type !== 'message.completed') void context.refreshTimeline?.(event.sessionId);
      void context.refreshTurnChangeSet?.(event.sessionId);
    }
    void context.refreshWorkspaceChanges?.(event.workspaceId);
  }
}

function queueFromEvent(event: AgentEvent): AgentQueueSnapshot {
  return normalizeMessageQueue(event.payload, event.sessionId, event.occurredAt);
}

function agentMessage(event: AgentEvent, key: MessageKey, params: MessageParams = {}): LocalizedText {
  return localizedMessage(key, {agent: eventAgentLabel(event), ...params});
}

function eventAgentLabel(event: AgentEvent): string {
  const agent = event.source.agent ?? event.source.agentId;
  if (agent === 'pi' || agent === 'dev.aibo.pi.agent') return 'Pi';
  if (agent === 'codex' || agent === 'dev.aibo.codex.agent') return 'Codex';
  return 'Agent';
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
    options: approvalOptions(event.payload.options),
  };
}

/** Provider-offered approval options; malformed or duplicate entries are dropped, never guessed. */
function approvalOptions(value: unknown): ApprovalOption[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.slice(0, 16).flatMap((option) => {
    if (!option || typeof option !== 'object') return [];
    const item = option as Record<string, unknown>;
    const id = payloadString(item.id);
    if (!id || id.length > 256 || seen.has(id) || (item.kind !== 'allow' && item.kind !== 'reject')) return [];
    seen.add(id);
    const label = payloadString(item.label)?.trim();
    return [{ id, kind: item.kind, label: label ? label.slice(0, 80) : null }];
  });
}

function userInputFromEvent(event: AgentEvent): UserInputRequest | null {
  const requestId = payloadString(event.payload.requestId);
  const rawQuestions = Array.isArray(event.payload.questions) ? event.payload.questions : [];
  if (!requestId || rawQuestions.length === 0) return null;
  const questions = rawQuestions
    .slice(0, 8)
    .flatMap((value, index) => {
      if (!value || typeof value !== 'object') return [];
      const record = value as Record<string, unknown>;
      const question = stringPayload(record.question)?.trim();
      if (!question) return [];
      const rawOptions = Array.isArray(record.options) ? record.options : [];
      const options = rawOptions.flatMap((option) => {
        if (!option || typeof option !== 'object') return [];
        const item = option as Record<string, unknown>;
        const label = stringPayload(item.label)?.trim();
        if (!label) return [];
        return [{
          label,
          description: stringPayload(item.description),
        }];
      });
      return [{
        id: stringPayload(record.id)?.trim() || `question-${index + 1}`,
        header: stringPayload(record.header),
        question,
        options,
        isOther: record.isOther === true,
      }];
    });
  if (questions.length === 0) return null;
  return {
    requestId,
    sessionId: event.sessionId,
    turnId: event.turnId,
    questions,
    isBlocking: event.payload.isBlocking !== false,
  };
}

function stringPayload(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function correlationString(event: AgentEvent, key: string): string | null {
  return event.correlation ? stringPayload(event.correlation[key]) : null;
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
