import { languageStorageKey, parseLanguagePreference, resolveLocale } from '../../../packages/i18n/index.js';
import type { LanguagePreference, Locale } from '../../../packages/i18n/index.js';

export type LanguageState = { preference: LanguagePreference; locale: Locale };
export type LanguagePorts = {
  storage: { getItem(key: string): string | null; setItem(key: string, value: string): void };
  languages(): readonly string[];
  changed(state: LanguageState): void;
};

/** App-wide preference; never tied to a workspace, session or presentation. */
export function createLanguageController(ports: LanguagePorts) {
  let preference: LanguagePreference = 'system';
  try { preference = parseLanguagePreference(ports.storage.getItem(languageStorageKey)); } catch { /* Storage is optional in preview. */ }
  function publish(): LanguageState {
    const state = { preference, locale: resolveLocale(preference, ports.languages()) };
    ports.changed(state);
    return state;
  }
  publish();
  return {
    select(value: LanguagePreference) {
      preference = parseLanguagePreference(value);
      try { ports.storage.setItem(languageStorageKey, preference); } catch { /* Keep the current window usable. */ }
      return publish();
    },
    receive(value: string | null) { preference = parseLanguagePreference(value); return publish(); },
    refresh: publish,
  };
}
