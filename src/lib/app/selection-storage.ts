export const selectedSessionStorageKey = 'aibo.selected-session';

export type PersistedSelection = {
  workspaceId: string;
  sessionId: string;
};

export function parsePersistedSelection(raw: string | null): PersistedSelection | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const value = parsed as Record<string, unknown>;
    return typeof value.workspaceId === 'string' && value.workspaceId.trim() &&
        typeof value.sessionId === 'string' && value.sessionId.trim()
      ? { workspaceId: value.workspaceId, sessionId: value.sessionId }
      : null;
  } catch {
    return null;
  }
}

export function readPersistedSelection(storage: Pick<Storage, 'getItem'>): PersistedSelection | null {
  try {
    return parsePersistedSelection(storage.getItem(selectedSessionStorageKey));
  } catch {
    return null;
  }
}

export function writePersistedSelection(
  storage: Pick<Storage, 'setItem' | 'removeItem'>,
  selection: PersistedSelection | null,
): void {
  try {
    if (selection) storage.setItem(selectedSessionStorageKey, JSON.stringify(selection));
    else storage.removeItem(selectedSessionStorageKey);
  } catch {
    // Storage can be unavailable in a restricted WebView.
  }
}
