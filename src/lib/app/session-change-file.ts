import type { WorkspaceFileChange } from '../types';

/** Preserve both index and working-tree changes without inventing missing counts. */
export function sessionChangeFile(file: WorkspaceFileChange) {
  const basename = (path: string) => path.split('/').at(-1) ?? path;
  const directory = (path: string) => path.slice(0, path.lastIndexOf('/') + 1);
  const hasWorking = file.unstaged || file.untracked || file.conflicted;
  const stateLabel = file.conflicted ? '合并冲突' : file.untracked ? '未跟踪' : file.staged && hasWorking ? '部分暂存' : file.staged ? '已暂存' : '未暂存';
  const kind = file.conflicted ? 'conflicted' : file.untracked ? 'added' : file.kind;
  const markers = { added: 'A', modified: 'M', deleted: 'D', renamed: 'R', conflicted: 'U' };
  const labels = { added: '新增', modified: '修改', deleted: '删除', renamed: '重命名', conflicted: '合并冲突' };
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
    statsTitle: file.staged && hasWorking ? '工作区与暂存区行数合计（非净差异）' : file.staged ? '暂存区行数' : '工作区行数' };
}

export const sessionChangeRowId = (repositoryId: string, path: string) => `session-change-${encodeURIComponent(JSON.stringify([repositoryId, path]))}`;
