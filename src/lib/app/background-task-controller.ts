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

/** Each response is bounded; old providers without a cursor still finish in one request. */
export async function readBackgroundTaskPages(invoke: (input: Record<string, unknown>) => Promise<Record<string, unknown>>, active: () => boolean = () => true) {
  const tasks: unknown[] = [], seen = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 128 && active(); page++) {
    const result = await invoke(cursor ? {cursor} : {});
    if (!Array.isArray(result.tasks)) throw new Error('Invalid background task page');
    tasks.push(...result.tasks);
    if(tasks.length>128)throw new Error('Background task count exceeds its contract');
    if (result.nextCursor == null) return {tasks};
    if (typeof result.nextCursor !== 'string' || seen.has(result.nextCursor)) throw new Error('Invalid background task cursor');
    cursor=result.nextCursor;seen.add(cursor);
  }
  if (active()) throw new Error('Background task page limit exceeded');
  return {tasks:[]};
}

export async function readBackgroundTaskOutput(taskId: string, invoke: (input: Record<string, unknown>) => Promise<Record<string, unknown>>, active: () => boolean) {
  let output='', cursor=0, revision: string | undefined, truncated=false;
  for(let page=0;page<4 && active();page++) {
    const result=await invoke({taskId,cursor,...(revision?{revision}:{})});
    if(typeof result.output!=='string' || typeof result.revision!=='string' || (revision && revision!==result.revision)) throw new Error('Background output changed');
    output+=result.output;revision=result.revision;truncated ||= result.truncated===true;
    if(result.nextCursor==null)return {output,truncated};
    if(typeof result.nextCursor!=='number'||result.nextCursor<=cursor)throw new Error('Invalid background output cursor');
    cursor=result.nextCursor;
  }
  if(active())throw new Error('Background output page limit exceeded');
  return null;
}

export function applyBackgroundTaskOutput(items: TimelineItem[], taskId: string, result: {output: string; truncated: boolean}): TimelineItem[] {
  return items.map(item => {
    if(item.toolName !== 'background_task' || item.externalMessageId !== `background:${taskId}`) return item;
    return {...item,content:JSON.stringify({...JSON.parse(item.content),output:result.output,outputTruncated:result.truncated})};
  });
}
