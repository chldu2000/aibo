import { catalogs, localizedMessage, localizedList, translateMessage } from '../../../packages/i18n/index.js';
import type { Locale, LocalizedText, LocalizedMessage, MessageKey, MessageParams, MessageValue } from '../../../packages/i18n/index.js';

export class LocalizedError extends Error {
  readonly localized: LocalizedText;
  constructor(key: MessageKey, params: MessageParams = {}, diagnostic?: string) {
    super(translateMessage('en', localizedMessage(key, params)));
    // Explicit host diagnostics retain their protocol text independently of display language.
    if (diagnostic !== undefined) this.message = diagnostic;
    this.name = 'LocalizedError';
    this.localized = localizedMessage(key, params);
  }
}

/** Read explicit host display metadata; preserve raw diagnostics when it is invalid. */
export function readNativeMessage(value: unknown): LocalizedMessage | null {
  if (!value || typeof value !== 'object' || !('schema' in value) || value.schema !== 'aibo.host-message/v1') return null;
  function parameter(value: unknown, depth: number): MessageValue | null {
    if (depth > 8) return null;
    if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) return value;
    if (value && typeof value === 'object' && 'kind' in value && value.kind === 'list' && 'items' in value && Array.isArray(value.items) && value.items.length <= 5000) {
      const items = value.items.map(item => parameter(item, depth + 1));
      return items.some(item => item === null) ? null : localizedList(items as MessageValue[]);
    }
    return parse(value, depth);
  }
  function parse(value: unknown, depth: number): LocalizedMessage | null {
    if (depth > 8 || !value || typeof value !== 'object' || !('key' in value) || typeof value.key !== 'string'
      || !value.key.startsWith('native.') || !Object.hasOwn(catalogs.en, value.key) || !('params' in value)
      || !value.params || typeof value.params !== 'object' || Array.isArray(value.params)) return null;
    const params: MessageParams = {};
    for (const [key, valueParameter] of Object.entries(value.params)) {
      const parsed = parameter(valueParameter, depth + 1);
      if (parsed === null) return null;
      params[key] = parsed;
    }
    try {
      const message = localizedMessage(value.key as MessageKey, params);
      translateMessage('en', message);
      return message;
    } catch { return null; }
  }
  return parse(value, 0);
}

export function toErrorText(error: unknown): LocalizedText {
  if (error instanceof LocalizedError) return error.localized;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) {
    return ('localized' in error ? readNativeMessage(error.localized) : null) ?? String(error.message);
  }
  return localizedMessage('error.operationFailed');
}

/** Legacy string consumers can opt into a locale; display state should retain toErrorText. */
export function toErrorMessage(error: unknown, locale: Locale = 'zh-CN'): string {
  return translateMessage(locale, toErrorText(error));
}
