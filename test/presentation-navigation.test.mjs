import test from 'node:test';
import assert from 'node:assert/strict';
import { navigationActions, resolveNavigationIntent } from '../src/lib/presentation-runtime/navigation.ts';
const context = { workspaceId: 'w1', sessionId: 's1', revision: 4 };
const state = {
  agentChoices: [{ id: 'external-installation/provider', label: 'External Agent', icon: { path: 'M2 2L22 22Z' } }],
  workspaces: [{ id: 'w1', label: 'One', path: '/one', trust: 'trusted' }, { id: 'w2', label: 'Two', path: '/two', trust: 'untrusted' }],
  sessionsByWorkspace: { w1: [{ id: 's1', workspaceId: 'w1', agent: 'codex', label: 'A', state: 'idle', archived: false, updatedAt: '' }],
    w2: [{ id: 's2', workspaceId: 'w2', agent: 'pi', label: 'B', state: 'running', archived: false, updatedAt: '' }, { id: 's3', workspaceId: 'w2', agent: 'plugin', label: 'C', state: 'idle', archived: true, updatedAt: '' }] },
  selectedWorkspaceId: 'w1', selectedSessionId: 's1', expandedWorkspaceIds: ['w1','w2'], sessionsLoadingWorkspaceIds: [],
  busy: false, threadBusy: false, archivingWorkspaceId: null, archivingSessionId: null,
  sessionSearchOpen: false, sessionFilterOpen: false, sessionSearch: '', sessionFilter: 'active', createSessionWorkspaceId: null, renamingSessionId: 's1', sessionLabelDraft: 'New',
};
function intent(operation, targetId, value, event = 'click', source = context) {
  return { id: `navigation:${operation}:${targetId ?? ''}`, context: source, event, ...(value === undefined ? {} : { value }) };
}
test('navigation covers all workspace sessions and rejects unavailable lifecycle actions', () => {
  assert.equal(resolveNavigationIntent(state, context, intent('selectSession','s2')).targetId, 's2');
  assert.equal(resolveNavigationIntent(state, context, intent('archiveSession','s2')), null);
  assert.equal(resolveNavigationIntent(state, context, intent('unarchiveSession','s3')).operation, 'unarchiveSession');
  assert.equal(resolveNavigationIntent(state, context, intent('syncSession','s2')), null);
  assert.equal(resolveNavigationIntent(state, context, intent('removeWorkspace','unknown')), null);
  assert.equal(resolveNavigationIntent({...state,busy:true}, context, intent('createPi','w2')), null);
  assert.equal(resolveNavigationIntent({...state,archivingSessionId:'s1'}, context, intent('selectSession','s1')), null);
  assert.equal(resolveNavigationIntent({...state,threadBusy:true}, context, intent('syncSession','s1')), null);
  const create = navigationActions(state).find(action=>action.operation==='createAgent'&&action.targetId==='w2');
  assert.equal(create.choiceId, state.agentChoices[0].id);
  const click = { id: create.token, context, event: 'click' };
  assert.equal(resolveNavigationIntent(state, context, click).targetId, 'w2');
  assert.equal(resolveNavigationIntent({...state, agentChoices: []}, context, click), null);
  assert.equal(resolveNavigationIntent({...state, busy: true}, context, click), null);
});
test('navigation validates context, event, current rename target and bounded values', () => {
  assert.equal(resolveNavigationIntent(state, context, intent('archiveSession','s1',undefined,'input')), null);
  assert.equal(resolveNavigationIntent(state, context, intent('archiveSession','s1',undefined,'click',{...context,revision:3})), null);
  assert.equal(resolveNavigationIntent(state, context, intent('search',undefined,'text','input',{...context,revision:3})).operation,'search');
  assert.equal(resolveNavigationIntent(state, context, intent('search',undefined,'text','input',{...context,sessionId:'other'})),null);
  assert.equal(resolveNavigationIntent(state, context, intent('filter',undefined,'invented','change')),null);
  assert.equal(resolveNavigationIntent(state, context, intent('filter',undefined,'archived','change')).operation,'filter');
  assert.equal(resolveNavigationIntent(state, context, intent('renameDraft','s1','x'.repeat(121),'input')),null);
  assert.equal(resolveNavigationIntent({...state,renamingSessionId:'s2'}, context, intent('renameDraft','s1','New','input')),null);
  assert.equal(resolveNavigationIntent({...state,sessionLabelDraft:'  '}, context, intent('saveRename','s1')),null);
  assert.equal(resolveNavigationIntent(state, context, intent('renameDraft','s1',undefined,'input')),null);
});
