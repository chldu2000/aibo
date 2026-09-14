export type ViewScope = { workspaceId: string; contributionId: string };
export type ViewState = { selection: string | null; detail: string | null; offset: number; layout: 'central' | 'sidebar' };
export type ViewStateStore = { read(scope: ViewScope): ViewState; write(scope: ViewScope, state: ViewState): void };
type StoragePort = { getItem(key: string): string | null; setItem(key: string, value: string): void };
const empty = (): ViewState => ({ selection: null, detail: null, offset: 0, layout: 'central' });
const retentionMs = 30 * 24 * 60 * 60 * 1000;

/** Host navigation state only. Drafts and timeline history keep their existing Core storage. */
export function createViewStateStore(storage?: StoragePort, windowId = 'main', now = Date.now): ViewStateStore {
  const memory = new Map<string, { state: ViewState; savedAt: number }>();
  const key = (scope: ViewScope) => `aibo.presentation-state.v1.${encodeURIComponent(windowId)}.${encodeURIComponent(JSON.stringify([scope.workspaceId, scope.contributionId]))}`;
  function valid(value: unknown): value is ViewState {
    if (!value || typeof value !== 'object') return false;
    const state = value as Record<string, unknown>;
    return [state.selection, state.detail].every(id => id === null || (typeof id === 'string' && id.length <= 8192))
      && typeof state.offset === 'number' && Number.isInteger(state.offset) && state.offset >= 0 && state.offset < 10000
      && (state.layout === 'central' || state.layout === 'sidebar');
  }
  return {
    read(scope) {
      const id = key(scope);
      try {
        const record = memory.get(id) ?? JSON.parse(storage?.getItem(id) ?? 'null');
        if (record && valid(record.state) && typeof record.savedAt === 'number' && Number.isFinite(record.savedAt) && now() - record.savedAt <= retentionMs) {
          return structuredClone(record.state);
        }
      } catch { /* A malformed or unavailable cache must not block navigation. */ }
      return empty();
    },
    write(scope, state) {
      if (!valid(state)) throw new Error('invalid presentation state');
      const record = { state: structuredClone(state), savedAt: now() };
      memory.set(key(scope), record);
      try { storage?.setItem(key(scope), JSON.stringify(record)); } catch { /* Keep working in memory. */ }
    },
  };
}
