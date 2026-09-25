import type { UiThemeRegistration } from './contract';

/** Brightness changes never silently select a different declared palette. */
export function themeForColorScheme(
  themes: readonly UiThemeRegistration[],
  currentId: string,
  colorScheme: UiThemeRegistration['colorScheme'],
): UiThemeRegistration | undefined {
  const current = themes.find(theme => theme.id === currentId);
  if (!current) return undefined;
  return themes.find(theme => theme.colorScheme === colorScheme && theme.palette?.id === current.palette?.id);
}

/** Only explicitly grouped catalogs get a separate palette picker. */
export function themePaletteOptions(themes: readonly UiThemeRegistration[], currentId: string) {
  const current = themes.find(theme => theme.id === currentId);
  if (!current?.palette || themes.some(theme => !theme.palette)) return [];
  const palettes = new Map(themes.map(theme => [theme.palette!.id, theme.palette!]));
  return Array.from(palettes.values(), palette => {
    const variants = themes.filter(theme => theme.palette?.id === palette.id);
    const theme = variants.find(theme => theme.colorScheme === current.colorScheme);
    return { ...palette, themeId: theme?.id, swatches: (theme ?? variants[0]).swatches };
  });
}
