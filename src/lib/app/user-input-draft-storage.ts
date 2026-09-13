type StoragePort = { getItem(key: string): string | null; setItem(key: string, value: string): void };
const storageKey = (windowId: string) => `aibo.answer-drafts.v1.${encodeURIComponent(windowId)}`;
const limit = 8 * 1024 * 1024;
function validKey(key: string): boolean {
  try {
    const parts = JSON.parse(key);
    return key.length <= 32768 && Array.isArray(parts) && parts.length === 4
      && parts.slice(0, 3).every(value => typeof value === 'string' && value.length > 0)
      && (parts[3] === null || typeof parts[3] === 'string') && JSON.stringify(parts) === key;
  } catch { return false; }
}
function bounded(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries: [string, string][] = []; let size = 128;
  for (const [key, draft] of Object.entries(value).slice(-256).reverse()) {
    if (!validKey(key) || typeof draft !== 'string' || draft.length > 1024 * 1024) continue;
    const bytes = JSON.stringify([key, draft]).length;
    if (size + bytes > limit) continue;
    size += bytes; entries.push([key, draft]);
  }
  return Object.fromEntries(entries.reverse());
}
export function readUserInputDrafts(storage: Pick<StoragePort, 'getItem'> | null, windowId: string, now = Date.now()): Record<string, string> {
  try {
    const text = storage?.getItem(storageKey(windowId));
    if (!text || text.length > limit) return {};
    const record = JSON.parse(text);
    if (!Number.isFinite(record?.savedAt) || record.savedAt > now || now - record.savedAt > 30 * 24 * 60 * 60 * 1000) return {};
    return bounded(record.drafts);
  } catch { return {}; }
}
export function writeUserInputDrafts(storage: Pick<StoragePort, 'setItem'> | null, windowId: string, drafts: Record<string, string>, now = Date.now()): void {
  try { storage?.setItem(storageKey(windowId), JSON.stringify({ savedAt: now, drafts: bounded(drafts) })); }
  catch { /* Unavailable storage must not discard live answers or block submission. */ }
}
