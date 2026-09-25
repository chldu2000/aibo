import type { SessionModelCatalog, SessionModelOption, SessionReasoningOption } from '$lib/types';

type StoragePort = Pick<Storage, 'getItem' | 'setItem'>;
const KEY = 'aibo.session-models.v1';
const MAX_AGE = 7 * 86_400_000;
const MAX_ENTRIES = 30;
const MAX_BYTES = 1_000_000;
const nullableString = (value: unknown) => value === null || typeof value === 'string';
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object';
function option(value: unknown): value is SessionReasoningOption {
  return record(value) && typeof value.id === 'string' && typeof value.label === 'string' && nullableString(value.description);
}
function model(value: unknown): value is SessionModelOption {
  return record(value) && typeof value.reference === 'string' && typeof value.id === 'string'
    && typeof value.label === 'string' && nullableString(value.provider) && nullableString(value.description)
    && typeof value.isDefault === 'boolean' && nullableString(value.defaultReasoningEffort)
    && Array.isArray(value.reasoningEfforts) && value.reasoningEfforts.every(option)
    && Array.isArray(value.serviceTiers) && value.serviceTiers.every(option)
    && (value.contextWindows === undefined || (Array.isArray(value.contextWindows) && value.contextWindows.every(item =>
      option(item) && (!('tokens' in item) || item.tokens === null || (typeof item.tokens === 'number' && Number.isFinite(item.tokens))))));
}
function catalog(value: unknown): value is SessionModelCatalog {
  return record(value) && (value.current === null || model(value.current))
    && Array.isArray(value.models) && value.models.every(model)
    && Array.isArray(value.reasoningEfforts) && value.reasoningEfforts.every(option)
    && nullableString(value.currentReasoningEffort) && nullableString(value.currentServiceTier)
    && (value.currentContextWindow === undefined || nullableString(value.currentContextWindow));
}

/** Last confirmed display data, keyed by immutable host session identity. Never execution authority. */
export function createSessionModelCache(storage: StoragePort | null, now = Date.now) {
  const entries = new Map<string, {savedAt: number; catalog: SessionModelCatalog}>();
  const pending = new Map<string, Promise<SessionModelCatalog>>();
  const fresh = (savedAt: number) => Number.isFinite(savedAt) && now() >= savedAt && now() - savedAt < MAX_AGE;
  try {
    const raw = storage?.getItem(KEY);
    const parsed: unknown = raw && raw.length <= MAX_BYTES ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) for (const item of parsed.slice(-MAX_ENTRIES)) {
      if (!Array.isArray(item) || typeof item[0] !== 'string' || !record(item[1])) continue;
      const entry = item[1];
      if (typeof entry.savedAt === 'number' && fresh(entry.savedAt) && catalog(entry.catalog)) {
        entries.set(item[0], {savedAt: entry.savedAt, catalog: entry.catalog});
      }
    }
  } catch { /* Invalid or unavailable storage cannot block navigation. */ }
  return {
    get(id: string): SessionModelCatalog | undefined {
      const entry = entries.get(id);
      return entry && fresh(entry.savedAt) ? entry.catalog : undefined;
    },
    set(id: string, value: SessionModelCatalog): void {
      entries.delete(id);
      entries.set(id, {savedAt: now(), catalog: value});
      while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value!);
      try {
        const persisted = [...entries];
        let serialized = JSON.stringify(persisted);
        while (serialized.length > MAX_BYTES && persisted.length) {
          persisted.shift(); serialized = JSON.stringify(persisted);
        }
        storage?.setItem(KEY, serialized);
      } catch { /* Keep confirmed data in memory when persistence fails. */ }
    },
    invalidate(id: string): void { pending.delete(id); },
    load(id: string, read: (id: string) => Promise<SessionModelCatalog>): Promise<SessionModelCatalog> {
      const existing = pending.get(id);
      if (existing) return existing;
      const request = read(id).finally(() => { if (pending.get(id) === request) pending.delete(id); });
      pending.set(id, request);
      return request;
    },
  };
}
