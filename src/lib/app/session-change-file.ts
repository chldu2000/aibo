import { translate } from '../../../packages/i18n/index.js';
import type { Locale } from '../../../packages/i18n/index.js';
import type { WorkspaceFileChange } from '../types';

/** Preserve both index and working-tree changes without inventing missing counts. */
export function sessionChangeFile(file: WorkspaceFileChange, locale: Locale = 'zh-CN') {
  const basename = (path: string) => path.split('/').at(-1) ?? path;
  const directory = (path: string) => path.slice(0, path.lastIndexOf('/') + 1);
  const hasWorking = file.unstaged || file.untracked || file.conflicted;
  const stateLabel = file.conflicted ? translate(locale, 'git.conflicted') : file.untracked ? translate(locale, 'changes.untracked') : file.staged && hasWorking ? translate(locale, 'changes.partiallyStaged') : file.staged ? translate(locale, 'git.staged') : translate(locale, 'changes.unstaged');
  const kind = file.conflicted ? 'conflicted' : file.untracked ? 'added' : file.kind;
  const markers = { added: 'A', modified: 'M', deleted: 'D', renamed: 'R', conflicted: 'U' };
  const labels = { added: translate(locale, 'git.added'), modified: translate(locale, 'git.modified'), deleted: translate(locale, 'git.deleted'), renamed: translate(locale, 'git.renamed'), conflicted: translate(locale, 'git.conflicted') };
  const parts = [ ...(file.staged ? [file.stagedStats] : []), ...(hasWorking ? [file.unstagedStats] : []) ];
  const stats = !file.conflicted && parts.length && parts.every(part => part && Number.isFinite(part.additions) && Number.isFinite(part.deletions) && part.additions >= 0 && part.deletions >= 0)
    ? parts.reduce<{ additions: number; deletions: number }>((sum, part) => ({ additions: sum.additions + part!.additions, deletions: sum.deletions + part!.deletions }), { additions: 0, deletions: 0 })
    : null;
  const previous = file.previousPath;
  const name = previous ? `${basename(previous)} → ${basename(file.path)}` : basename(file.path);
  const location = previous && directory(previous) !== directory(file.path)
    ? `${directory(previous) || '.'} → ${directory(file.path) || '.'}` : directory(file.path);
  return { name, directory: location, marker: markers[kind], kind, kindLabel: labels[kind], stateLabel, hasWorking,
    defaultStaged: file.staged && !hasWorking, stats,
    fullPath: previous ? `${previous} → ${file.path}` : file.path,
    statsTitle: file.staged && hasWorking ? translate(locale, 'changes.combinedStats') : file.staged ? translate(locale, 'changes.stagedStats') : translate(locale, 'changes.workingStats') };
}

export const sessionChangeRowId = (repositoryId: string, path: string) => `session-change-${encodeURIComponent(JSON.stringify([repositoryId, path]))}`;
