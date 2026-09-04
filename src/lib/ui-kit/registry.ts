import type { UiKitAdapter } from './contract';
import { shadcnUiKit } from './kits/shadcn';

/**
 * Build-time kit registry. Add an adapter import and one entry here when a
 * second visual library is introduced, then set VITE_AIBO_UI_KIT to its name.
 * The fallback keeps local development deterministic when the variable is
 * missing or misspelled.
 */
const kits = {
  shadcn: shadcnUiKit,
} satisfies Record<string, UiKitAdapter>;

const requestedKit = import.meta.env.VITE_AIBO_UI_KIT?.trim() || 'shadcn';
export const activeUiKit = (kits as Record<string, UiKitAdapter>)[requestedKit] ?? kits.shadcn;
export type UiKitName = keyof typeof kits;
