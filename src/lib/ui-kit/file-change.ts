import type { UiFileChangeMarkProps } from './contract';

/** Host-owned symbols and accessible names shared by kits and external control projections. */
export const fileChangeStates: Record<UiFileChangeMarkProps['kind'], { symbol: string; label: string }> = {
  added: { symbol: 'A', label: '新增' },
  modified: { symbol: 'M', label: '修改' },
  deleted: { symbol: 'D', label: '删除' },
  renamed: { symbol: 'R', label: '重命名' },
  conflicted: { symbol: 'U', label: '合并冲突' },
};
