import type { WorkspaceFileDiff } from '../types';

export type SessionDiffState = { repositoryId: string | null; path: string | null; staged: boolean; diff: WorkspaceFileDiff | null; loading: boolean; error: string | null };
export const emptySessionDiff = (): SessionDiffState => ({ repositoryId: null, path: null, staged: false, diff: null, loading: false, error: null });

/** Discard reads after closing, selecting another file, or switching sessions. */
export function createSessionDiffController(read: (workspaceId: string, path: string, staged: boolean, repositoryId: string) => Promise<WorkspaceFileDiff>, publish: (state: SessionDiffState) => void) {
  let generation = 0;
  return {
    close() { generation++; publish(emptySessionDiff()); },
    async open(workspaceId: string, repositoryId: string, path: string, staged: boolean) {
      const ticket = ++generation;
      publish({ ...emptySessionDiff(), repositoryId, path, staged, loading: true });
      try {
        const diff = await read(workspaceId, path, staged, repositoryId);
        if (ticket === generation) publish({ repositoryId, path, staged, diff, loading: false, error: null });
      } catch (error) {
        if (ticket === generation) publish({ repositoryId, path, staged, diff: null, loading: false, error: String(error) });
      }
    },
  };
}
