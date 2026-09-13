import type { PresentationInspector, PresentationInspectorAction } from '../../../packages/plugin-protocol/src/presentation-inspector';
import type { PresentationContext, PresentationIntent } from '../../../packages/plugin-protocol/src/presentation-runtime';
import { createActionDirectory } from './action-directory.ts';
type Spec = Omit<PresentationInspectorAction, 'token'>;
export function inspectorActions(state: PresentationInspector): Spec[] {
  const actions: Spec[] = [];
  const add = (operation: Spec['operation'], args: Spec['args'] = []) => actions.push({operation,args,event:'click'});
  add('selectView',['context']); add('selectView',['git']);
  if (state.artifactPreview.artifactId) add('closeArtifact');
  if (!state.desktop || !state.workspace) return actions;
  if (!state.busy) add('refresh');
  if (!state.busy && !state.threadBusy) add('syncThreads');
  const session = state.session;
  if (!session || session.workspaceId !== state.workspace.id) return actions;
  for (const artifact of state.artifacts) if (artifact.sessionId === session.id && artifact.workspaceId === state.workspace.id) add('toggleArtifact',[artifact.id]);
  const change = state.changeSet;
  if (!change || change.sessionId !== session.id || change.workspaceId !== state.workspace.id || state.busy || state.running || state.archiving) return actions;
  const writable = state.workspace.trust === 'trusted' && !session.archived;
  const git = writable && state.workspaceChanges?.workspaceId === state.workspace.id && state.workspaceChanges.captureStatus === 'captured';
  for (const file of change.files) {
    add('showDiff',[change.turnId,file.path]);
    if (git) {
      add('fileAction',[change.turnId,file.path,'stage']); add('fileAction',[change.turnId,file.path,'unstage']);
      if (!file.baselineDirty) add('fileAction',[change.turnId,file.path,'revert']);
    }
  }
  if (writable && change.files.length && change.attribution === 'agent') add('restoreTurn',[change.turnId]);
  const diff = state.fileDiff;
  const file = diff && change.files.find(file => file.path === diff.path);
  if (git && diff?.available && file && file.kind !== 'renamed' && !state.fileDiffLoading) {
    for (const hunk of diff.hunks) for (const action of ['stage','unstage','revert']) add('hunkAction',[change.turnId,file.path,String(hunk.index),action]);
  }
  return actions;
}
export function createInspectorDirectory() {
  const directory = createActionDirectory<Spec>('inspector');
  const scope = (state: PresentationInspector) => JSON.stringify([state.workspace?.id ?? null,state.session?.id ?? null,state.changeSet?.turnId ?? null]);
  return {
    project: (state: PresentationInspector) => directory.project(inspectorActions(state),scope(state)),
    resolve: (state: PresentationInspector, context: PresentationContext, intent: PresentationIntent) => directory.resolve(inspectorActions(state),scope(state),context,intent),
  };
}
