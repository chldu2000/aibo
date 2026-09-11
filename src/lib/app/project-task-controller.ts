import type { ProjectActionRun } from '../types';

/** Own pending submissions outside renderer lifetimes. The host remains authoritative. */
export function createProjectTaskController(ports: {
  requestId(): string;
  execute(workspaceId: string, actionId: string, sessionId: string | null, requestId: string): Promise<ProjectActionRun>;
}) {
  const pending = new Map<string, Promise<ProjectActionRun>>();
  return {
    run(workspaceId: string, actionId: string, sessionId: string | null): Promise<ProjectActionRun> {
      const key = JSON.stringify([workspaceId, actionId, sessionId]);
      const existing = pending.get(key);
      if (existing) return existing;
      const requestId = ports.requestId();
      const result = Promise.resolve().then(() => ports.execute(workspaceId, actionId, sessionId, requestId));
      const settled = result.finally(() => pending.delete(key));
      pending.set(key, settled);
      return settled;
    },
  };
}

/** Observe durable history while visible; disposing a reader never cancels a writer. */
export function observeProjectTaskHistory(ports: {
  read(): Promise<ProjectActionRun[]>;
  publish(runs: ProjectActionRun[]): void;
  error(error: unknown): void;
}, interval = 750): () => void {
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function poll(): Promise<void> {
    try {
      const runs = await ports.read();
      if (!disposed) ports.publish(runs);
    } catch (error) {
      if (!disposed) ports.error(error);
    } finally {
      if (!disposed) timer = setTimeout(() => void poll(), interval);
    }
  }
  void poll();
  return () => { disposed = true; clearTimeout(timer); };
}
