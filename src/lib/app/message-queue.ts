import type { AgentQueueSnapshot, QueuedMessage } from '../types';

/** Both responses and events pass through the same versioned snapshot parser. */
export function normalizeMessageQueue(value: Record<string, unknown>, sessionId: string, updatedAt = ''): AgentQueueSnapshot {
  const strings = (items: unknown): string[] => Array.isArray(items) ? items.flatMap(item => {
    if (typeof item === 'string') return item.trim() ? [item.trim()] : [];
    if (!item || typeof item !== 'object') return [];
    const text = ['text', 'message', 'content', 'prompt', 'input'].map(key => item[key]).find(value => typeof value === 'string' && value.trim());
    return typeof text === 'string' ? [text.trim()] : [];
  }) : [];
  const items: QueuedMessage[] = Array.isArray(value.items) ? value.items.flatMap(item => {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || typeof item.text !== 'string') return [];
    return [{ id: item.id, text: item.text, status: ['pending', 'sending', 'failed', 'uncertain'].includes(item.status) ? item.status : 'pending', error: typeof item.error === 'string' ? item.error : null, createdAt: typeof item.createdAt === 'string' ? item.createdAt : '' }];
  }) : [];
  return { sessionId, items, paused: value.paused === true, revision: typeof value.revision === 'number' ? value.revision : 0,
    steering: strings(value.steering), followUp: strings(value.followUp), updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : updatedAt };
}

export function newerMessageQueue(current: AgentQueueSnapshot | null, next: AgentQueueSnapshot): AgentQueueSnapshot {
  return current?.sessionId === next.sessionId && (current.revision ?? 0) > (next.revision ?? 0) ? current : next;
}
