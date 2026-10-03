import type { Session, TimelineItem } from '../types';

/** One observational request at a time; selection changes cancel future polling. */
export function watchBackgroundTasks(session: Session, ports: {
  invoke: (session: Session) => Promise<unknown>;
  failed: () => void;
  schedule?: (callback: () => void, delay: number) => ReturnType<typeof globalThis.setTimeout> | number;
  clear?: (timer: ReturnType<typeof globalThis.setTimeout> | number) => void;
}) {
  if (session.archived || session.historyOnly || !session.capabilities.includes('background-tasks.list')) return () => {};
  let disposed = false;
  let timer: ReturnType<typeof globalThis.setTimeout> | number | undefined;
  const schedule = ports.schedule ?? ((callback: () => void, delay: number) => globalThis.setTimeout(callback, delay));
  const clear = ports.clear ?? ((timer: ReturnType<typeof globalThis.setTimeout> | number) => globalThis.clearTimeout(timer));
  async function poll() {
    try { await ports.invoke(session); }
    catch { if (!disposed) ports.failed(); }
    finally { if (!disposed) timer = schedule(() => { void poll(); }, 2000); }
  }
  // Start asynchronously so host reactive state read by the port is not a dependency.
  timer = schedule(() => { void poll(); }, 0);
  return () => { disposed = true; if (timer !== undefined) clear(timer); };
}

export function reconcileBackgroundTasks(items: TimelineItem[], result?: { tasks?: unknown }): TimelineItem[] {
  if (!result) return items.map(item => item.toolName === 'background_task' && item.status === 'streaming' ? {...item, status: 'interrupted'} : item);
  if (!Array.isArray(result.tasks)) return items;
  const running = new Set(result.tasks.flatMap((task: unknown) => {
    if (!task || typeof task !== 'object' || !('status' in task) || !('id' in task)) return [];
    return task.status === 'running' && typeof task.id === 'string' ? [`background:${task.id}`] : [];
  }));
  return items.map(item => item.toolName === 'background_task' && running.has(item.externalMessageId ?? '') && item.status !== 'streaming' ? {...item, status: 'streaming'} : item);
}
