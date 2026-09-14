import type { PresentationContext } from '../../../packages/plugin-protocol/src/presentation-runtime';

/** Only replaceable workbench descendants receive this context. */
export const PRESENTATION_CONTROLS = Symbol('aibo.presentation.controls');
export type PresentationControlScope = {
  context(): PresentationContext;
  suspended(): boolean;
};
