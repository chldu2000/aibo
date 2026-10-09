import { derived, writable } from 'svelte/store';
import { translate } from '../../../packages/i18n/index.js';
import type { Translator } from '../../../packages/i18n/index.js';
import type { LanguageState } from '../app/language-controller';

// Composition initializes this before mounting children; stores keep component identities stable.
export const language = writable<LanguageState>({ preference: 'system', locale: 'en' });
export const locale = derived(language, value => value.locale);
export const t = derived(locale, value => ((key, params) => translate(value, key, params)) as Translator);
