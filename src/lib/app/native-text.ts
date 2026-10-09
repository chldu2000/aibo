import {translateMessage} from '../../../packages/i18n/index.js';
import type {Locale} from '../../../packages/i18n/index.js';
import type {TurnDiffHunk} from '../types';
import {readNativeMessage} from './error-utils.ts';

/** Translate only an explicitly marked host suffix; all preceding text stays literal. */
export function nativeTextWithSuffix(text: string, metadata: unknown, locale: Locale): string {
  const suffix = readNativeMessage(metadata);
  if (!suffix || !['native.diff.truncatedSuffix', 'native.search.truncatedSuffix'].includes(suffix.key)) return text;
  const original = translateMessage('zh-CN', suffix);
  return original && text.endsWith(original)
    ? text.slice(0, -original.length) + translateMessage(locale, suffix)
    : text;
}

export function nativeDiffText(value: {diff: string; hunks: TurnDiffHunk[]; localizedSuffix?: unknown}, locale: Locale) {
  const suffix = readNativeMessage(value.localizedSuffix);
  const marked = suffix && suffix.key === 'native.diff.truncatedSuffix' && value.diff.endsWith(translateMessage('zh-CN', suffix));
  const metadata = marked ? value.localizedSuffix : undefined;
  return {diff: nativeTextWithSuffix(value.diff, metadata, locale),
    hunks: value.hunks.map((hunk, index) => index === value.hunks.length - 1
      ? {...hunk, content: nativeTextWithSuffix(hunk.content, metadata, locale)}
      : hunk),
  };
}
