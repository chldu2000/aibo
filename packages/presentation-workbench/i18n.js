import {translate} from './i18n.generated.js';

/** Legacy hosts omitted locale and rendered Chinese; no global mutable language state. */
export function presentationTranslator(locale = 'zh-CN') {
  const language = locale === 'en' ? 'en' : 'zh-CN';
  return (key, params) => translate(language, key, params);
}
