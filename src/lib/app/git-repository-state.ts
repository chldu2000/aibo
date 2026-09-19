export type RepositoryView = { selected: string | null; collapsed: string[]; files?: Record<string, { path: string; staged: boolean }> };
export const repositoryDraftKey = (workspaceId: string, repositoryId: string | null) => repositoryId && repositoryId !== '.' ? JSON.stringify([workspaceId, repositoryId]) : workspaceId;
export function readRepositoryViews(storage: Pick<Storage, 'getItem'> | null, windowId: string): Record<string, RepositoryView> {
  const result: Record<string, RepositoryView> = {};
  try {
    const raw = JSON.parse(storage?.getItem(`aibo.git-repositories.${windowId}`) ?? '{}');
    for (const [key, value] of Object.entries(raw)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key) || !value || typeof value !== 'object') continue;
      const item = value as Record<string, unknown>;
      result[key] = { selected: typeof item.selected === 'string' ? item.selected : null, collapsed: Array.isArray(item.collapsed) ? item.collapsed.filter((id): id is string => typeof id === 'string') : [] };
      if (item.files && typeof item.files === 'object') {
        const files: NonNullable<RepositoryView['files']> = {};
        for (const [repository, selection] of Object.entries(item.files)) {
          if (['__proto__', 'constructor', 'prototype'].includes(repository) || !selection || typeof selection !== 'object') continue;
          if (typeof selection.path === 'string' && typeof selection.staged === 'boolean') files[repository] = { path: selection.path, staged: selection.staged };
        }
        result[key].files = files;
      }
    }
  } catch { /* Storage is optional. */ }
  return result;
}
export function writeRepositoryViews(storage: Pick<Storage, 'setItem'> | null, windowId: string, views: Record<string, RepositoryView>) {
  try { storage?.setItem(`aibo.git-repositories.${windowId}`, JSON.stringify(views)); } catch { /* Keep live state. */ }
}
