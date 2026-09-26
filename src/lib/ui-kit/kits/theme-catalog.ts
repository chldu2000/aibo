import type { UiThemeRegistration } from '../contract';

/** Reserved for preinstalled trusted releases; local package installation rejects this prefix. */
export const BUILTIN_PRESENTATION_PREFIX = 'dev.aibo.builtin.';

type ThemeCatalog = {
  id: string;
  label: string;
  description: string;
  defaultThemeId: string;
  /** Kit foundation shared by every theme; each theme carries only the values it changes. */
  tokens?: Readonly<Record<string, string>>;
  /** JSON catalogs widen literal fields; the registry validates ids and schemes on selection. */
  themes: readonly { id: string; colorScheme: string; tokens: Readonly<Record<string, string>> }[];
};

export function builtinRegistration({ tokens: foundation = {}, themes, ...metadata }: ThemeCatalog) {
  return {
    ...metadata,
    packageId: `${BUILTIN_PRESENTATION_PREFIX}${metadata.id}`,
    themes: themes.map(theme => ({ ...theme, tokens: { ...foundation, ...theme.tokens } })) as UiThemeRegistration[],
  };
}
