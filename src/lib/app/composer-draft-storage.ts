import type { ComposerDraft } from '$lib/types';

export const composerDraftsStorageKey = 'aibo.composer-drafts.v1';

export type ComposerDrafts = Record<string, ComposerDraft>;

function isDraft(value: unknown): value is ComposerDraft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Record<string, unknown>;
  return typeof draft.text === 'string'
    && typeof draft.updatedAt === 'string'
    && (draft.sendFailed === undefined || typeof draft.sendFailed === 'boolean');
}

export function parseComposerDrafts(raw: string | null): ComposerDrafts {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => isDraft(value)),
    ) as ComposerDrafts;
  } catch {
    return {};
  }
}

export function readComposerDrafts(storage: { getItem(key: string): string | null }): ComposerDrafts {
  return parseComposerDrafts(storage.getItem(composerDraftsStorageKey));
}

export function writeComposerDrafts(
  storage: { setItem(key: string, value: string): void; removeItem(key: string): void },
  drafts: ComposerDrafts,
): void {
  const entries = Object.entries(drafts)
    .filter(([, draft]) => draft.text.trim().length > 0)
    .sort(([, left], [, right]) => right.updatedAt.localeCompare(left.updatedAt));
  if (entries.length === 0) {
    storage.removeItem(composerDraftsStorageKey);
    return;
  }
  storage.setItem(composerDraftsStorageKey, JSON.stringify(Object.fromEntries(entries)));
}
