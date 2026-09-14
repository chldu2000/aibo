import { validateRenderer } from './renderer-descriptor.ts';
export { validateRenderer } from './renderer-descriptor.ts';
import type { Snapshot } from '../presentation/contract.ts';
import { LEGACY_SNAPSHOT_SCHEMAS, type RendererDescriptor, type PresentationPreference, type PresentationChoice } from '../presentation/renderer-contract.ts';
import { assertSnapshot } from '../presentation/validation.ts';

/** A specialization receives the same validated core data as its fallback.
 * No alternate reduced payload can silently discard relationships or actions. */
export function choosePresentation(descriptor: RendererDescriptor, snapshot: Snapshot, preference: PresentationPreference | null = null): PresentationChoice {
  validateRenderer(descriptor);
  assertSnapshot(snapshot);
  if (!(descriptor.snapshotSchemas ?? LEGACY_SNAPSHOT_SCHEMAS).includes(snapshot.schema)) throw Error('incompatible_renderer: snapshot version not supported');
  const semantic = snapshot.view.kind;
  const extension = preference && descriptor.optional.find(item => item.id === preference.id && item.version === preference.version && item.semantic === semantic);
  if (extension) return { kind: 'specialized', id: extension.id, snapshot: structuredClone(snapshot) };
  return { kind: 'core', semantic, snapshot: structuredClone(snapshot), reason: preference ? 'specialized_presentation_unavailable' : null };
}
