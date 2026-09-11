export type WorkspaceWriteCommand =
  | 'apply_workspace_git_file_action' | 'apply_workspace_git_action'
  | 'commit_workspace_changes' | 'checkout_workspace_git_branch'
  | 'create_workspace_git_branch' | 'sync_workspace_git'
  | 'apply_git_hunk_action' | 'apply_workspace_git_stash' | 'stash_workspace_git' | 'apply_git_file_action';

/** A window-local pending submission owner. The host enforces durable identity. */
export function createWorkspaceWriteController(ports: {
  requestId(): string;
  execute<T>(command: WorkspaceWriteCommand, input: Record<string, unknown>, requestId: string): Promise<T>;
}) {
  const pending = new Map<string, Promise<unknown>>();
  return {
    invoke<T>(command: WorkspaceWriteCommand, input: Record<string, unknown>, requestId?: string): Promise<T> {
      const key = JSON.stringify([command, input, requestId ?? null]);
      const existing = pending.get(key);
      if (existing) return existing as Promise<T>;
      const id = requestId ?? ports.requestId();
      const result = Promise.resolve().then(() => ports.execute<T>(command, input, id));
      const settled = result.finally(() => pending.delete(key));
      pending.set(key, settled);
      return settled;
    },
  };
}
