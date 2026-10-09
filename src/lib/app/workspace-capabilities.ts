import { translateMessage } from '../../../packages/i18n/index.js';
import type { Locale } from '../../../packages/i18n/index.js';
import type { WorkspaceCapabilityInventory } from '../types';
import { readNativeMessage } from './error-utils.ts';

export function workspaceCapabilityPresentation(inventory: WorkspaceCapabilityInventory | null, locale: Locale): Omit<WorkspaceCapabilityInventory, 'localizedWarnings'> | null {
  if (!inventory) return null;
  const { localizedWarnings, ...value } = inventory;
  const metadata = Array.isArray(localizedWarnings) && localizedWarnings.length === value.warnings.length ? localizedWarnings : [];
  return { ...value, warnings: value.warnings.map((warning, index) => translateMessage(locale, readNativeMessage(metadata[index]) ?? warning)) };
}
