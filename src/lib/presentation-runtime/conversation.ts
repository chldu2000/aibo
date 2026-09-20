import type { PresentationConversation, PresentationConversationAction } from '../../../packages/plugin-protocol/src/presentation-conversation';
import type { PresentationContext, PresentationIntent } from '../../../packages/plugin-protocol/src/presentation-runtime';
import { createActionDirectory } from './action-directory.ts';
import { answeredRequest } from '../app/user-input-drafts.ts';
import { parseSubagent } from '../app/subagents.ts';

import {splitSessionReferences} from '../../../packages/presentation-workbench/session-references.js';
import {markdownTargets} from '../../../packages/presentation-workbench/markdown.js';

type Spec = Omit<PresentationConversationAction, 'token'>;
export function conversationActions(state: PresentationConversation): Spec[] {
  const entries: Spec[] = [];
  const add = (operation: Spec['operation'], args: Spec['args'] = [], event: Spec['event'] = 'click') => entries.push({ operation, args, event });
  for(const entry of state.timelineVisibleCount>0?state.timeline.slice(-state.timelineVisibleCount):[])for(const target of markdownTargets(entry.role === 'user' ? splitSessionReferences(entry.content).body : entry.content))add(target.kind==='code'?'copyCode':'openLink',[entry.id,String(target.index),target.value]);
  for (const entry of state.timeline) {
    const child = entry.toolName === 'subagent' ? parseSubagent(entry.content) : null;
    if (child) add('openSubagent', [child.id]);
  }
  const session = state.session;
  if (state.timeline.length > state.timelineVisibleCount) add('loadOlder');
  if (!session) return entries;
  const bound = Boolean(session.pluginInstallationId);
  const available = bound && !session.archived && !state.archiving && !state.busy;
  const hasImage = state.attachments.some(item => item.sessionId === session.id && item.turnId === null && item.sendStrategy === 'inline' && item.mediaType.startsWith('image/'));
  const capable = (name: string) => bound && session.capabilities.includes(name);
  if (available && (!state.running || capable('queue.manage'))) {
    add('draft', [], 'input'); add('addAttachments'); add('addDirectory');
    for (const item of state.attachments) if (item.sessionId === session.id && item.turnId === null) add('removeAttachment', [item.id]);
    for (const item of state.sessionSuggestions ?? []) if (item.id !== session.id && item.workspaceId === session.workspaceId) add('selectSessionReference', [item.id]);
    for (const item of state.workspacePathSuggestions) add('selectPath', [item.path]);
    for (const command of state.agentCommands) if (command.enabled !== false) add('selectCommand', [command.name]);
  }
  if (available && !state.goalBusy && state.goal) {
    if (capable('goal.pause') && (state.goal.status === 'active' || state.goal.status === 'paused' && state.running)) add('pauseGoal');
    if (!state.running && capable('goal.resume') && ['active','paused','blocked','usageLimited'].includes(state.goal.status)) add('resumeGoal');
  }
  if (available && !state.running) {
    if (!state.goalBusy && capable('goal.manage') && state.goal && state.goal.status !== 'cleared') add('clearGoal');
    if (state.draft.trim() || hasImage) add('send');
    if (state.retryPrompt) add('retry');
    if (!state.modelCatalogLoading) add('loadModels');
    if (capable('model.select')) for (const model of state.modelCatalog?.models ?? []) {
      add('selectModel', [model.reference, null]);
      if (capable('model.reasoning')) for (const effort of model.reasoningEfforts) add('selectModel', [model.reference, effort.id]);
    }
    const fastTier = state.modelCatalog?.current?.serviceTiers.find(tier => tier.label.trim().toLowerCase() === 'fast');
    if (capable('model.service-tier') && fastTier) add('selectServiceTier', [state.modelCatalog?.currentServiceTier === fastTier.id ? 'default' : fastTier.id]);
    const contextWindows = state.modelCatalog?.current?.contextWindows ?? [];
    if (capable('model.context-window') && !state.modelCatalogLoading && contextWindows.length) {
      add('selectContextWindow', [state.modelCatalog!.current!.reference, ...contextWindows.map(option => option.id)], 'change');
    }
    const access = state.executionProfile?.sessionId === session.id ? state.executionProfile.sessionControls ?? [] : [];
    for (const option of access) add('selectAccess', [option.id]);
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
      if (state.draft.trim() || hasImage) { if (capable('queue.steer')) add('queueSteer'); add('queueFollowUp'); }

    }
  }
  if (available && capable('queue.manage') && state.queue?.sessionId === session.id) {
    const items = state.queue.items ?? [];
    if (items.some(item => item.status !== 'sending') || state.queue.steering.length || state.queue.followUp.length) add('clearQueue');
    if (state.queue.paused && items.length && !items.some(item => item.status === 'uncertain')) add('resumeQueue');
    for (const item of items) {
      if (item.status === 'sending') continue;
      add('removeQueuedMessage', [item.id]);
      if (item.status !== 'uncertain' && (!state.running || capable('queue.steer'))) add('sendQueuedMessage', [item.id]);
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
    resolve: (state: PresentationConversation, context: PresentationContext, intent: PresentationIntent) => {
      const action = directory.resolve(conversationActions(state), scope(state), context, intent);
      if (action?.operation === 'selectContextWindow' && (intent.context.revision !== context.revision || !action.args.slice(1).includes(intent.value ?? null))) return null;
      return action;
    },
  };
}
