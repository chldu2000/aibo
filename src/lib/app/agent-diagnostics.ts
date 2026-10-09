import { translateMessage } from '../../../packages/i18n/index.js';
import type { Locale } from '../../../packages/i18n/index.js';
import type { AgentDiagnostic } from '../types';
import { readNativeMessage } from './error-utils.ts';

export function agentDiagnosticsPresentation(items: AgentDiagnostic[], locale: Locale): Omit<AgentDiagnostic, 'localizedMessage' | 'localizedVersion'>[] {
  return items.map(({ localizedMessage, localizedVersion, ...item }) => ({ ...item,
    message: item.message === null ? null : translateMessage(locale, readNativeMessage(localizedMessage) ?? item.message),
    version: item.version === null ? null : translateMessage(locale, readNativeMessage(localizedVersion) ?? item.version),
  }));
}
