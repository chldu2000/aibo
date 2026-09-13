import type { PresentationConversation, PresentationConversationAction } from '../../../packages/plugin-protocol/src/presentation-conversation';
import type { PresentationContext, PresentationIntent } from '../../../packages/plugin-protocol/src/presentation-runtime';
import { createActionDirectory } from './action-directory.ts';
import { answeredRequest } from '../app/user-input-drafts.ts';
import { sessionAgentKind } from '../app/agent-kind.ts';

type Spec = Omit<PresentationConversationAction, 'token'>;
export function conversationActions(state: PresentationConversation): Spec[] {
  const entries: Spec[] = [];
  const add = (operation: Spec['operation'], args: Spec['args'] = [], event: Spec['event'] = 'click') => entries.push({ operation, args, event });
  const session = state.session;
  if (state.timeline.length > state.timelineVisibleCount) add('loadOlder');
  if (!session) return entries;
  const bound = Boolean(session.pluginInstallationId);
  const available = bound && !session.archived && !state.archiving && !state.busy;
  const capable = (name: string) => bound && session.capabilities.includes(name);
  if (available && (!state.running || capable('queue.manage'))) {
    add('draft', [], 'input'); add('addAttachments'); add('addDirectory');
    for (const item of state.attachments) if (item.sessionId === session.id && item.turnId === null) add('removeAttachment', [item.id]);
    for (const item of state.workspacePathSuggestions) add('selectPath', [item.path]);
    for (const command of state.agentCommands) if (command.enabled !== false) add('selectCommand', [command.name]);
  }
  if (available && !state.running) {
    if (state.draft.trim()) add('send');
    if (state.retryPrompt) add('retry');
    if (!state.modelCatalogLoading) add('loadModels');
    if (capable('model.select')) for (const model of state.modelCatalog?.models ?? []) {
      add('selectModel', [model.reference, null]);
      if (capable('model.reasoning')) for (const effort of model.reasoningEfforts) add('selectModel', [model.reference, effort.id]);
    }
    const access = sessionAgentKind(session) === 'codex' ? ['ask-for-approval', 'approve-for-me', 'full-access'] : ['read-only', 'plan', 'workspace-write'];
    for (const mode of access) add('selectAccess', [mode]);
    if (capable('compaction.run') && !state.compacting) add('compact');
    if (capable('session.fork')) {
      add('fork');
      const turns = new Set(state.timeline.filter(item => item.role === 'assistant' && item.status === 'completed' && item.turnId).map(item => item.turnId!));
      for (const turn of turns) add('fork', [turn]);
    }
  }
  if (bound && state.running && !state.busy && !state.archiving) {
    add('stop');
    if (capable('queue.manage')) {
      if (state.draft.trim()) { add('queueSteer'); add('queueFollowUp'); }
      if (state.queue?.sessionId === session.id && (state.queue.steering.length || state.queue.followUp.length)) add('clearQueue');
    }
  }
  for (const request of state.userInputRequests) {
    if (request.sessionId !== session.id || !bound || state.archiving || state.busy) continue;
    for (const question of request.questions) {
      const target = [request.requestId, question.id];
      if (question.isOther || !question.options.length) add('answer', [...target, request.turnId], 'input');
      for (const option of question.options) add('chooseAnswer', [...target, option.label, request.turnId]);
    }
    if (answeredRequest(request, state.answerDrafts)) add('submitAnswers', [request.requestId, request.turnId]);
    add('cancelAnswers', [request.requestId, request.turnId]);
  }
  if (capable('session.tree') && !state.archiving) {
    add('openTree');
    if (state.treeOpen && !state.treeNavigationStatus) {
      add('closeTree');
      if (!state.busy && !state.running) {
        add('refreshTree');
        if (state.tree?.sessionId === session.id) {
          const pending = [...state.tree.tree];
          while (pending.length) { const node = pending.pop()!; add('selectTreeNode', [node.id]); pending.push(...node.children); }
        }
      }
    }
  }
  return entries;
}

export function createConversationDirectory() {
  const directory = createActionDirectory<Spec>('conversation');
  const scope = (state: PresentationConversation) => JSON.stringify([state.workspace?.id ?? null, state.session?.id ?? null]);
  return {
    project: (state: PresentationConversation) => directory.project(conversationActions(state), scope(state)),
    resolve: (state: PresentationConversation, context: PresentationContext, intent: PresentationIntent) => directory.resolve(conversationActions(state), scope(state), context, intent),
  };
}
