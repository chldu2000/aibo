import { choosePresentation } from '../app/renderer-negotiation.ts';
import type { Snapshot } from '../presentation/contract';
import type { PresentationPreference, RendererDescriptor } from '../presentation/renderer-contract';
import type { WebPresentationAdapter } from './types';

/** Executable adapters are supplied by the trusted build, never deserialized from a manifest. */
export type SpecializedAdapter = { id: string; version: string; adapter: WebPresentationAdapter };
export function resolvePresentationAdapter(descriptor: RendererDescriptor, snapshot: Snapshot, preference: PresentationPreference | null,
  core: WebPresentationAdapter, implementations: readonly SpecializedAdapter[]) {
  const choice = choosePresentation(descriptor, snapshot, preference);
  if (choice.kind === 'specialized') {
    const implementation = implementations.find(item => item.id === choice.id && item.version === preference?.version);
    if (implementation) return { adapter: implementation.adapter, choice };
    return { adapter: core, choice: { kind: 'core' as const, semantic: snapshot.view.kind, snapshot: choice.snapshot, reason: 'specialized_implementation_unavailable' } };
  }
  return { adapter: core, choice };
}
