import type { LocalizedText } from '../../../packages/i18n/index.js';
import { localizedMessage, localizedList } from '../../../packages/i18n/index.js';
import type { TurnChangeSet, TurnFileDiff, GitFileAction, GitFileActionResult, GitHunkActionResult, RestoreTurnChangeSetResult } from '../types';
import type { SetNotice } from './notifications';
import { LocalizedError, toErrorText, readNativeMessage } from './error-utils.ts';
import { nativeListMessages } from './turn-change-presentation.ts';

export type TurnChangeState = { diff: TurnFileDiff | null; loading: boolean; error: LocalizedText | null };
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
  error(message: LocalizedText): void;
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
      if (diff.path !== path) throw new LocalizedError('error.turnDiffIdentity', {}, 'turn_diff_identity_mismatch');
      options.changed({ diff, error: null, loading: false });
    } catch (error) {
      if (owns()) {
        const message = toErrorText(error);
        options.changed({ diff: null, loading: false, error: message }); options.error(message);
      }
    }
  }
  async function apply(session: string, action: GitFileAction, target: 'file' | 'hunk', execute: () => Promise<GitFileActionResult | GitHunkActionResult>) {
    try {
      const result = await execute();
      if (!result.applied) { options.error(readNativeMessage(result.localizedMessage) ?? result.message); return; }
      const operation = action === 'stage' ? 'Staged' : action === 'unstage' ? 'Unstaged' : 'Reverted';
      const message = localizedMessage(`turn.${target}${operation}`);
      options.notice(message, 'success');
      await options.workspaceChanged(session);
    } catch (error) { options.error(toErrorText(error)); }
  }
  async function restore(session: string, turn: string) {
    if (!options.desktop()) return;
    try {
      const result = await options.api.restoreTurnChangeSet(session, turn);
      if (result.applied) {
        options.notice(result.restored.length ? localizedMessage('turn.restored', {count: result.restored.length}) : localizedMessage('turn.noRestores'), result.restored.length ? 'success' : 'info');
        await options.restored(session);
      } else if (result.conflicts.length) options.notice(localizedMessage('turn.restoreConflicts', {count: result.conflicts.length}), 'warning');
      else options.notice(result.unsupported.length ? localizedMessage('turn.restoreUnsupported', {reason: localizedList(nativeListMessages(result.unsupported, result.localizedUnsupported))}) : localizedMessage('turn.restoreUnsafe'), 'warning');
    } catch (error) { options.error(toErrorText(error)); }
  }
  return {
    reset, showDiff, restore,
    applyFile: (session: string, turn: string, path: string, action: GitFileAction) =>
      apply(session, action, 'file', () => options.api.applyGitFileAction(session, path, action, turn)),
    applyHunk: (session: string, turn: string, path: string, hunk: number, action: GitFileAction) =>
      apply(session, action, 'hunk', () => options.api.applyGitHunkAction(session, turn, path, hunk, action)),
  };
}
