import type { WorkspaceFileDiff } from '../types';
import type { GitRepositoryState } from '../../../packages/plugin-protocol/src/presentation-git';
import { sessionChangeFile } from './session-change-file.ts';

export type SessionDiffState = { repositoryId: string | null; path: string | null; staged: boolean; diff: WorkspaceFileDiff | null; loading: boolean; error: string | null };
export const emptySessionDiff = (): SessionDiffState => ({ repositoryId: null, path: null, staged: false, diff: null, loading: false, error: null });

/** Discard reads after closing, selecting another file, or switching sessions. */
export function createSessionDiffController(read: (workspaceId: string, path: string, staged: boolean, repositoryId: string) => Promise<WorkspaceFileDiff>, publish: (state: SessionDiffState) => void) {
  let generation = 0;
  let state = emptySessionDiff();
  const update = (value: SessionDiffState) => { state = value; publish(value); };
  const controller = {
    close() { generation++; update(emptySessionDiff()); },
    reconcile(workspaceId: string | null, repositories: GitRepositoryState[], loading: boolean) {
      if (!state.path || loading) return;
      const repo = repositories.find(item => item.id === state.repositoryId);
      const file = repo?.changes?.files.find(item => item.path === state.path);
      if (!file || repo?.error || repo?.changes?.captureStatus !== 'captured' || !(file.staged || file.unstaged || file.untracked || file.conflicted)) controller.close();
      else if (workspaceId && (state.staged ? !file.staged : !(file.unstaged || file.untracked || file.conflicted)))
        void controller.open(workspaceId, repo!.id, state.path, sessionChangeFile(file).defaultStaged);
    },
    async open(workspaceId: string, repositoryId: string, path: string, staged: boolean) {
      const ticket = ++generation;
      update({ ...emptySessionDiff(), repositoryId, path, staged, loading: true });
      try {
        const diff = await read(workspaceId, path, staged, repositoryId);
        if (ticket === generation) update({ repositoryId, path, staged, diff, loading: false, error: null });
      } catch (error) {
        if (ticket === generation) update({ repositoryId, path, staged, diff: null, loading: false, error: String(error) });
      }
    },
  };
  return controller;
}
