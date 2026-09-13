import type { Snapshot, ActionMessage } from '../presentation/contract';
import type { PresentationInput } from '../../../packages/plugin-protocol/src/presentation-runtime';
import { assertSnapshot } from '../presentation/validation.ts';
import { actionMessage } from '../presentation/actions.ts';

export function semanticActions(snapshot: Snapshot) {
  assertSnapshot(snapshot);
  const actions: { token: string; label: string; action: ActionMessage }[] = [];
  for (const action of snapshot.actions) {
    if (!action.enabled) continue;
    const itemIds = action.id === 'inspect' || action.id === 'open-diff'
      ? snapshot.view.kind === 'collection' ? snapshot.view.items.map(item => item.id) : [] : [null];
    for (const itemId of itemIds) actions.push({ token: `semantic:${actions.length}`, label: action.label, action: actionMessage(snapshot, action.id, itemId) });
  }
  return actions;
}

export function semanticInput(snapshot: Snapshot, revision: number, theme: Readonly<Record<string, string>> = {}): PresentationInput {
  const actions = semanticActions(snapshot);
  return {
    surface: 'semantic', context: { workspaceId: snapshot.context.workspaceId, sessionId: snapshot.context.sessionId ?? null, revision },
    data: JSON.parse(JSON.stringify({ snapshot, actions })), theme,
  };
}

export function resolveSemanticIntent(snapshot: Snapshot, token: string): ActionMessage {
  const entry = semanticActions(snapshot).find(action => action.token === token);
  if (!entry) throw Error('unsupported_semantic_intent');
  return entry.action;
}

/** Compatibility preflight exercises every mandatory core kind, without business execution. */
export function semanticPreflightSnapshots(): Snapshot[] {
  return (['collection', 'detail', 'settings', 'inspector'] as const).map(kind => ({
    schema: 'aibo.semantic-view/v1',
    context: { workspaceId: 'preflight', contributionId: 'dev.aibo.preflight', generation: 'preflight', revision: 1 },
    contribution: { id: 'dev.aibo.preflight', extensionPoint: 'workspace.tool', title: 'Presentation compatibility' },
    state: { status: 'ready', message: '' },
    view: kind === 'collection'
      ? { kind, properties: [], items: [], selection: null, page: { offset: 0, size: 50, total: 0, truncated: false } }
      : { kind, itemId: 'preflight', properties: [], content: 'Presentation compatibility', truncated: false },
    actions: [],
  }));
}
