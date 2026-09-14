import { SEMANTIC_SCHEMA, type Context, type Snapshot } from './contract.ts';

export const GIT_CONTRIBUTION = 'dev.aibo.git.changes';
/** Data returned by the trusted read-only host port; never a UI component. */
export type GitPage = {
  context: Context;
  status: Snapshot['state']['status'];
  message: string;
  items: { id: string; path: string; previousPath: string | null; status: string; staged: boolean }[];
  offset: number;
  total: number;
  truncated: boolean;
  detail: { itemId: string; path: string; staged: boolean; content: string; truncated: boolean } | null;
};
export const GIT_STATUSES = ['added', 'modified', 'deleted', 'renamed', 'conflicted', 'untracked'];
export function projectGit(page: GitPage): Snapshot {
  const detail = page.detail;
  return {
    schema: SEMANTIC_SCHEMA,
    context: page.context,
    contribution: { id: GIT_CONTRIBUTION, extensionPoint: 'workspace.tool', title: '工作区变更' },
    state: { status: page.status, message: page.message },
    view: detail ? {
      kind: 'detail', itemId: detail.itemId,
      properties: [{ label: '文件', value: detail.path }, { label: '范围', value: detail.staged ? '暂存区' : '工作区' }],
      content: detail.content, truncated: detail.truncated,
    } : {
      kind: 'collection',
      properties: [
        { key: 'path', label: '文件', type: 'text', values: [] },
        { key: 'status', label: '状态', type: 'enum', values: GIT_STATUSES },
        { key: 'scope', label: '范围', type: 'enum', values: ['暂存区', '工作区'] },
      ],
      items: page.items.map(item => ({ id: item.id, values: { path: item.previousPath ? `${item.previousPath} → ${item.path}` : item.path, status: item.status, scope: item.staged ? '暂存区' : '工作区' } })),
      selection: null, page: { offset: page.offset, size: 50, total: page.total, truncated: page.truncated },
    },
    actions: detail ? [
      { id: 'back', label: '返回变更列表', intent: 'navigate', enabled: true },
      { id: 'refresh', label: '刷新', intent: 'refresh', enabled: true },
    ] : [
      { id: 'refresh', label: '刷新', intent: 'refresh', enabled: true },
      { id: 'open-diff', label: '查看差异', intent: 'inspect', enabled: page.status === 'ready' },
      { id: 'previous', label: '上一页', intent: 'navigate', enabled: page.offset > 0 },
      { id: 'next', label: '下一页', intent: 'navigate', enabled: page.offset + 50 < page.total },
    ],
  };
}
export { actionMessage } from './actions.ts';
