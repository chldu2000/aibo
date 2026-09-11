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
