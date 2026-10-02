import type { TurnChangeSet, TurnFileDiff, GitFileAction, GitFileActionResult, GitHunkActionResult, RestoreTurnChangeSetResult } from '../types';
import type { SetNotice } from './notifications';
import { toErrorMessage } from './error-utils.ts';

export type TurnChangeState = { diff: TurnFileDiff | null; loading: boolean; error: string | null };
export const emptyTurnChange = (): TurnChangeState => ({ diff: null, loading: false, error: null });

/** Session-scoped change inspection; read invalidation never discards a completed write. */
export function createTurnChangeController(options: {
  api: {
    getTurnFileDiff(session: string, turn: string, path: string): Promise<TurnFileDiff>;
    applyGitFileAction(session: string, path: string, action: GitFileAction, turn: string): Promise<GitFileActionResult>;
    applyGitHunkAction(session: string, turn: string, path: string, hunk: number, action: GitFileAction): Promise<GitHunkActionResult>;
    restoreTurnChangeSet(session: string, turn: string): Promise<RestoreTurnChangeSetResult>;
  };
  desktop(): boolean;
  context(): { sessionId: string | null; changeSet: TurnChangeSet | null };
  changed(state: TurnChangeState): void;
  error(message: string): void;
  notice: SetNotice;
  workspaceChanged(session: string): Promise<void>;
  restored(session: string): Promise<void>;
}) {
  let generation = 0;
  function reset() { ++generation; options.changed(emptyTurnChange()); }
  async function showDiff(session: string, turn: string, path: string) {
    const context = options.context();
    if (context.sessionId !== session || context.changeSet?.turnId !== turn || !context.changeSet.files.some(file => file.path === path)) return;
    const owner = ++generation;
    const owns = () => owner === generation && options.context().sessionId === session && options.context().changeSet?.turnId === turn;
    options.changed({ diff: null, error: null, loading: true });
    try {
      const diff = await options.api.getTurnFileDiff(session, turn, path);
      if (!owns()) return;
      if (diff.path !== path) throw Error('turn_diff_identity_mismatch');
      options.changed({ diff, error: null, loading: false });
    } catch (error) {
      if (owns()) {
        const message = toErrorMessage(error);
        options.changed({ diff: null, loading: false, error: message }); options.error(message);
      }
    }
  }
  async function apply(session: string, action: GitFileAction, label: string, execute: () => Promise<GitFileActionResult | GitHunkActionResult>) {
    try {
      const result = await execute();
      if (!result.applied) { options.error(result.message); return; }
      const message = action === 'stage' ? `${label}已暂存。`
        : action === 'unstage' ? (label === '文件' ? '已取消暂存。' : 'hunk 已取消暂存。')
        : `${label}变更已撤销。`;
      options.notice(message, 'success');
      await options.workspaceChanged(session);
    } catch (error) { options.error(toErrorMessage(error)); }
  }
  async function restore(session: string, turn: string) {
    if (!options.desktop()) return;
    try {
      const result = await options.api.restoreTurnChangeSet(session, turn);
      if (result.applied) {
        options.notice(result.restored.length ? `已恢复 ${result.restored.length} 个文件。` : '本轮没有可恢复的文件。', result.restored.length ? 'success' : 'info');
        await options.restored(session);
      } else if (result.conflicts.length) options.notice(`恢复已阻止：${result.conflicts.length} 个文件在本轮后发生了变化。`, 'warning');
      else options.notice(`恢复已阻止：${result.unsupported.join('、') || '当前变更无法安全恢复'}。`, 'warning');
    } catch (error) { options.error(toErrorMessage(error)); }
  }
  return {
    reset, showDiff, restore,
    applyFile: (session: string, turn: string, path: string, action: GitFileAction) =>
      apply(session, action, '文件', () => options.api.applyGitFileAction(session, path, action, turn)),
    applyHunk: (session: string, turn: string, path: string, hunk: number, action: GitFileAction) =>
      apply(session, action, 'hunk ', () => options.api.applyGitHunkAction(session, turn, path, hunk, action)),
  };
}
