import {nativeDiffText} from './native-text.ts';
import { translateMessage } from '../../../packages/i18n/index.js';
import type { Locale } from '../../../packages/i18n/index.js';
import type { WorkspaceFileDiff } from '../types';
import { readNativeMessage } from './error-utils.ts';

/** Resolve host display metadata before sending ordinary strings to a presentation. */
export function workspaceFileDiffPresentation(diff: WorkspaceFileDiff | null, locale: Locale): Omit<WorkspaceFileDiff, 'localizedReason' | 'localizedSuffix'> | null {
  if (!diff) return null;
  const { localizedReason, localizedSuffix, ...value } = diff;
  const message = diff.reason === null ? null : readNativeMessage(localizedReason);
  return { ...value, ...nativeDiffText(diff, locale), reason: message ? translateMessage(locale, message) : diff.reason };
}
