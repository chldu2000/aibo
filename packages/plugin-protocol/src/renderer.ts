import type { Snapshot } from './semantic.js';

/** Public data only. Executable renderer implementations stay in the trusted build. */
export const CORE_SEMANTICS = ['collection', 'detail', 'settings', 'inspector'] as const;
export type CoreSemantic = typeof CORE_SEMANTICS[number];
export const LEGACY_SNAPSHOT_SCHEMAS: readonly Snapshot['schema'][] = ['aibo.semantic-view/experimental-v1', 'aibo.semantic-view/v1'];
export const SUPPORTED_SNAPSHOT_SCHEMAS: readonly Snapshot['schema'][] = [...LEGACY_SNAPSHOT_SCHEMAS, 'aibo.semantic-view/v1.1'];
export type RendererDescriptor = {
  id: string;
  version: string;
  /** Version of the required semantic vocabulary, distinct from snapshot wire versions. */
  semanticVersion: '1.0.0';
  /** Omission retains only the original read-only snapshot readers. */
  snapshotSchemas?: readonly Snapshot['schema'][];
  core: readonly CoreSemantic[];
  optional: readonly { id: string; version: string; semantic: CoreSemantic }[];
};
export type PresentationPreference = { id: string; version: string };
export type PresentationChoice =
  | { kind: 'specialized'; id: string; snapshot: Snapshot }
  | { kind: 'core'; semantic: CoreSemantic; snapshot: Snapshot; reason: string | null };

