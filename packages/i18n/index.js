import en from './locales/en.json' with { type: 'json' };
import zhCN from './locales/zh-CN.json' with { type: 'json' };

export const catalogs = Object.freeze({ en, 'zh-CN': zhCN });
export const supportedLocales = Object.freeze(['zh-CN', 'en']);
export const languageStorageKey = 'aibo.language.v1';

/** Keep host-authored text unrendered while it lives in application state. */
export function localizedMessage(key, params = {}) {
  if (!Object.hasOwn(en, key)) throw new Error(`Unknown translation key: ${key}`);
  return Object.freeze({ key, params: Object.freeze({ ...params }) });
}

export function translateMessage(locale, message) {
  return typeof message === 'string' ? message : translate(locale, message.key, message.params);
}

export function localizedList(items) {
  return Object.freeze({ kind: 'list', items: Object.freeze([...items]) });
}

function parameterText(locale, value) {
  if (value && typeof value === 'object') {
    if (value.kind === 'list') return new Intl.ListFormat(locale).format(value.items.map(item => parameterText(locale, item)));
    return translateMessage(locale, value);
  }
  return String(value);
}

export function parseLanguagePreference(value) {
  return value === 'system' || supportedLocales.includes(value) ? value : 'system';
}

export function resolveLocale(preference, languages = []) {
  if (supportedLocales.includes(preference)) return preference;
  for (const language of languages) {
    if (/^zh(?:-|$)/i.test(language)) return 'zh-CN';
    if (/^en(?:-|$)/i.test(language)) return 'en';
  }
  return 'en';
}

/** Catalog lookup is independent of UI state and does not modify domain data. */
export function translate(locale, key, params = {}) {
  if (!Object.hasOwn(en, key)) throw new Error(`Unknown translation key: ${key}`);
  const message = catalogs[locale]?.[key] ?? en[key];
  if (typeof message !== 'string' && (typeof params.count !== 'number' || !Number.isFinite(params.count))) {
    throw new Error(`Missing or invalid plural count: ${key}`);
  }
  const template = typeof message === 'string' ? message
    : message[new Intl.PluralRules(locale).select(Number(params.count))] ?? message.other;
  return template.replace(/\{(\w+)\}/g, (_, name) => {
    if (!Object.hasOwn(params, name)) throw new Error(`Missing translation parameter: ${key}.${name}`);
    return parameterText(locale, params[name]);
  });
}

export function formatDateTime(locale, value, options = {}) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(locale, options).format(date) : '—';
}

export function formatNumber(locale, value, options = {}) {
  return new Intl.NumberFormat(locale, options).format(value);
}
