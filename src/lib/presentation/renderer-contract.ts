import type { Snapshot } from './contract';

/** Public data only. Executable renderer implementations stay in the trusted build. */
export const CORE_SEMANTICS = ['collection', 'detail', 'settings', 'inspector'] as const;
export type CoreSemantic = typeof CORE_SEMANTICS[number];
export type RendererDescriptor = {
  id: string;
  version: string;
  semanticVersion: '1.0.0';
  core: readonly CoreSemantic[];
  optional: readonly { id: string; version: string; semantic: CoreSemantic }[];
};
export type PresentationPreference = { id: string; version: string };
export type PresentationChoice =
  | { kind: 'specialized'; id: string; snapshot: Snapshot }
  | { kind: 'core'; semantic: CoreSemantic; snapshot: Snapshot; reason: string | null };

