import type { Snapshot, ActionMessage } from '../presentation/contract';
/** Trusted renderer props, not a public capability protocol. */
export type PresentationProps = { snapshot: Snapshot; layout: 'sidebar' | 'central'; onAction: (message: ActionMessage) => void; focusTarget?: string | null };
