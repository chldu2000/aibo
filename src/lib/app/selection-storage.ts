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

export function readPersistedSelection(storage: { getItem(key: string): string | null }, windowId = 'main'): PersistedSelection | null {
  try {
    const raw = storage.getItem(`${selectedSessionStorageKey}.v2.${encodeURIComponent(windowId)}`);
    return parsePersistedSelection(raw ?? (windowId === 'main' ? storage.getItem(selectedSessionStorageKey) : null));
  } catch {
    return null;
  }
}

export function writePersistedSelection(
  storage: { setItem(key: string, value: string): void; removeItem(key: string): void },
  selection: PersistedSelection | null,
  windowId = 'main',
): void {
  try {
    storage.setItem(`${selectedSessionStorageKey}.v2.${encodeURIComponent(windowId)}`, JSON.stringify(selection));
  } catch {
    // Storage can be unavailable in a restricted WebView.
  }
}
