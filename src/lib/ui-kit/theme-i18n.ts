import { translate } from '../../../packages/i18n/index.js';
import type { Locale } from '../../../packages/i18n/index.js';
import type { UiKitOption, UiThemeRegistration } from './contract';

/** Only built-in visual metadata belongs to the host catalog; external labels remain package data. */
export function localizeTheme(theme: UiThemeRegistration, kitId: string, locale: Locale): UiThemeRegistration {
  if (kitId !== 'ak-ui' && kitId !== 'material3') return theme;
  const mode = translate(locale, theme.colorScheme === 'dark' ? 'appearance.dark' : 'appearance.light');
  if (kitId === 'ak-ui') return { ...theme, label: mode, description: translate(locale, 'appearance.angular.themeDescription') };
  const paletteId = theme.palette?.id;
  if (paletteId !== 'blue' && paletteId !== 'forest' && paletteId !== 'plum') return theme;
  const name = translate(locale, `appearance.${paletteId}.name`);
  const description = translate(locale, `appearance.${paletteId}.description`);
  return {
    ...theme,
    label: paletteId === 'blue' ? mode : translate(locale, 'appearance.paletteMode', { palette: name, mode }),
    description: paletteId === 'blue' ? translate(locale, 'appearance.blue.themeDescription') : description,
    palette: { ...theme.palette!, label: name, description },
  };
}

export function localizeUiKit(kit: UiKitOption, locale: Locale): UiKitOption {
  if (kit.id !== 'ak-ui' && kit.id !== 'material3') return kit;
  return {
    ...kit,
    description: translate(locale, kit.id === 'ak-ui' ? 'appearance.angular.description' : 'appearance.rounded.description'),
    themes: kit.themes.map(theme => localizeTheme(theme, kit.id, locale)),
  };
}
