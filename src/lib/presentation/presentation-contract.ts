import type { Snapshot, ActionMessage } from './contract.ts';

/** Experimental JSON messages; mounting and DOM handles belong to local adapters. */
export type PresentationSnapshot<View = Snapshot> = {
  schema: 'aibo.presentation/experimental-v1';
  generation: number;
  view: View;
  recovery: { selection: string | null; detail: string | null; focus: string | null };
};
export type PresentationAction<Action = ActionMessage> = {
  schema: 'aibo.presentation-action/experimental-v1';
  generation: number;
  action: Action;
};
