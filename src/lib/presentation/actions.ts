import type { ActionMessage, Snapshot } from './contract.ts';

export function actionMessage(snapshot: Snapshot, actionId: ActionMessage['actionId'], itemId: string | null = null): ActionMessage {
  if (!snapshot.actions.some(action => action.id === actionId && action.enabled)) throw new Error('unsupported_action');
  if (actionId === 'open-diff' && (snapshot.view.kind !== 'collection' || !snapshot.view.items.some(item => item.id === itemId))) throw new Error('invalid_selection');
  if (actionId !== 'open-diff' && itemId !== null) throw new Error('invalid_selection');
  return { context: { ...snapshot.context }, actionId, itemId };
}
