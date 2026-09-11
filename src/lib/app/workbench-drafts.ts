export type GitPanelState = { commitMessage: string; branchDraft: string; gitSection: 'changes' | 'history'; selectedCommit: string | null };
export type PluginFormState = { fields: Record<string, string | number | boolean | null>; expanded: Record<string, boolean> };
export type WorkbenchDrafts = { git: Record<string, GitPanelState>; plugin: PluginFormState };
export const emptyGitPanelState = (): GitPanelState => ({ commitMessage: '', branchDraft: '', gitSection: 'changes', selectedCommit: null });
const key = (windowId: string) => `aibo.workbench-drafts.v1.${encodeURIComponent(windowId)}`;
export function readWorkbenchDrafts(storage: { getItem(key: string): string | null } | null, windowId: string): WorkbenchDrafts {
  const result: WorkbenchDrafts = { git: {}, plugin: { fields: {}, expanded: {} } };
  try {
    const raw = JSON.parse(storage?.getItem(key(windowId)) ?? 'null');
    for (const [id, value] of Object.entries(raw?.git ?? {})) {
      if (['__proto__','constructor','prototype'].includes(id) || !value || typeof value !== 'object') continue;
      const item = value as Record<string, unknown>;
      result.git[id] = { commitMessage: typeof item.commitMessage === 'string' ? item.commitMessage : '', branchDraft: typeof item.branchDraft === 'string' ? item.branchDraft : '', gitSection: item.gitSection === 'history' ? 'history' : 'changes', selectedCommit: typeof item.selectedCommit === 'string' ? item.selectedCommit : null };
    }
    result.plugin.fields = Object.fromEntries(Object.entries(raw?.plugin?.fields ?? {}).filter(([,value]) => value === null || ['string','number','boolean'].includes(typeof value))) as PluginFormState['fields'];
    result.plugin.expanded = Object.fromEntries(Object.entries(raw?.plugin?.expanded ?? {}).filter(([,value]) => typeof value === 'boolean')) as PluginFormState['expanded'];
  } catch { /* Corrupt/unavailable storage cannot stop the workbench. */ }
  return result;
}
export function writeWorkbenchDrafts(storage: { setItem(key: string, value: string): void } | null, windowId: string, value: WorkbenchDrafts) {
  try { storage?.setItem(key(windowId), JSON.stringify(value)); } catch { /* Keep the live host state. */ }
}
