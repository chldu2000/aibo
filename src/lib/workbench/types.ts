import type { Snapshot } from '../presentation/contract.ts';
/** Trusted local Web interface, deliberately outside the public data protocol. */
import type { PresentationProps } from '../ui-kit/presentation-props';
export type { PresentationProps } from '../ui-kit/presentation-props';
export type MountedPresentation = { update(snapshot: Snapshot, focusTarget?: string | null): void; dispose(): Promise<void> };
export type WebPresentationAdapter = { mount(target: HTMLElement, props: PresentationProps): Promise<MountedPresentation> };
