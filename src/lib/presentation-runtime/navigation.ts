import type { PresentationNavigation, PresentationNavigationAction } from '../../../packages/plugin-protocol/src/presentation-navigation';
import type { PresentationContext, PresentationIntent } from '../../../packages/plugin-protocol/src/presentation-runtime';

export const navigationFilters = ['active', 'all', 'archived', 'created', 'starting', 'running', 'waiting_approval', 'waiting_user', 'compacting', 'idle', 'interrupted', 'failed', 'closed'] as const;
const running = (state: string) => ['running', 'waiting_approval', 'waiting_user', 'compacting'].includes(state);

export function navigationActions(state: PresentationNavigation): PresentationNavigationAction[] {
  const actions: PresentationNavigationAction[] = [];
  const add = (operation: PresentationNavigationAction['operation'], targetId?: string, event: PresentationNavigationAction['event'] = 'click', options?: readonly string[]) => {
    actions.push({ token: `navigation:${operation}:${targetId ?? ''}`, operation, ...(targetId === undefined ? {} : { targetId }), event, ...(options ? { options } : {}) });
  };
  add('toggleSearch'); add('toggleFilter'); add('search', undefined, 'input'); add('filter', undefined, 'change', navigationFilters);
  if (state.selectedWorkspaceId) add('applyFilters');
  if (!state.busy) add('addWorkspace');
  for (const workspace of state.workspaces) {
    add('selectWorkspace', workspace.id);
    if (!state.busy) {
      for (const operation of ['toggleSessionCreator', 'toggleTrust', 'openWorkspace'] as const) add(operation, workspace.id);
      for (const choice of state.agentChoices ?? []) actions.push({
        token: `navigation:createAgent:${JSON.stringify([workspace.id, choice.id])}`,
        operation: 'createAgent', targetId: workspace.id, choiceId: choice.id, event: 'click',
      });
      if (state.archivingWorkspaceId !== workspace.id) add('removeWorkspace', workspace.id);
    }
    for (const session of state.sessionsByWorkspace[workspace.id] ?? []) {
      if (session.workspaceId !== workspace.id) continue;
      if (state.archivingSessionId !== session.id) add('selectSession', session.id);
      if (state.busy) continue;
      if (session.archived) add('unarchiveSession', session.id);
      else {
        if (!running(session.state) && state.archivingSessionId === null) add('archiveSession', session.id);
        if (session.canSyncSnapshot && !state.threadBusy && state.archivingSessionId !== session.id) add('syncSession', session.id);
      }
      if (state.archivingSessionId !== session.id) add('renameSession', session.id);
    }
  }
  if (state.renamingSessionId && Object.values(state.sessionsByWorkspace).some(sessions => sessions.some(session => session.id === state.renamingSessionId))) {
    add('renameDraft', state.renamingSessionId, 'input');
    if (!state.busy) {
      add('cancelRename', state.renamingSessionId);
      if (state.sessionLabelDraft.trim()) add('saveRename', state.renamingSessionId);
    }
  }
  return actions;
}

/** Re-resolve on current state. Local edits may cross revisions only within the same context. */
export function resolveNavigationIntent(state: PresentationNavigation, context: PresentationContext, intent: PresentationIntent): PresentationNavigationAction | null {
  if (intent.context.workspaceId !== context.workspaceId || intent.context.sessionId !== context.sessionId) return null;
  const action = navigationActions(state).find(action => action.token === intent.id && action.event === intent.event);
  if (!action) return null;
  if (intent.context.revision !== context.revision && action.event !== 'input') return null;
  if (action.event !== 'click' && typeof intent.value !== 'string') return null;
  if (action.options && !action.options.includes(intent.value!)) return null;
  if (action.operation === 'renameDraft' && intent.value!.length > 120) return null;
  return action;
}
