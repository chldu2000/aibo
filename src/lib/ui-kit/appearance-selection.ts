import type { AppearanceSelection, UiKitOption } from './contract';

/** Migrate only the former built-in appearance preference. External package
 * selection, workspace state and drafts have separate owners/storage keys. */
export function normalizeDefaultAppearance(value: unknown, kits: readonly Pick<UiKitOption, 'id' | 'themes'>[]): AppearanceSelection | null {
  if (!value || typeof value !== 'object') return null;
  const { kitId, themeId } = value as Partial<AppearanceSelection>;
  if (typeof kitId === 'string' && typeof themeId === 'string'
    && kits.some(kit => kit.id === kitId && kit.themes.some(theme => theme.id === themeId))) return { kitId, themeId };
  const legacyThemes: Record<string, readonly string[]> = {
    shadcn: ['zinc', 'blue', 'emerald', 'light'],
    material3: ['ocean', 'sage', 'violet', 'daylight'],
  };
  if (typeof kitId !== 'string' || typeof themeId !== 'string' || !Object.hasOwn(legacyThemes, kitId) || !legacyThemes[kitId].includes(themeId)) return null;
  return { kitId: 'ak-ui', themeId: themeId === 'light' || themeId === 'daylight' ? 'light' : 'dark' };
}
