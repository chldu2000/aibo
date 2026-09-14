import { writable } from 'svelte/store';
import type { InstalledPresentationPackage } from '../presentation-runtime/types';

/** Window-local active implementation. Installed declarations alone never activate code. */
export type ExternalPresentation = {
  package: InstalledPresentationPackage;
  theme: Readonly<Record<string, string>>;
  recover(): void;
};
export const externalPresentation = writable<ExternalPresentation | null>(null);
