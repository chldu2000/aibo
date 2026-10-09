import type { PresentationSidebar, PresentationSidebarAction, SidebarOperation } from '../../../packages/plugin-protocol/src/presentation-layout';
import type { PresentationContext, PresentationIntent } from '../../../packages/plugin-protocol/src/presentation-runtime';
import { createActionDirectory } from './action-directory.ts';
import { actionMessage } from '../presentation/actions.ts';
type Spec = Omit<PresentationSidebarAction, 'token'>;
export function sidebarActions(state: PresentationSidebar): Spec[] {
  const actions: Spec[] = [];
  const layout = (operation: SidebarOperation) => actions.push({operation:'layout',event:'click',args:[JSON.stringify(operation)]});
  for (const entry of state.entries) if (!entry.disabled) layout({kind:'open',target:JSON.parse(entry.value)});
  for (const pane of state.layout.panes) for (const tabId of pane.tabs) {
    layout({kind:'focus',tabId}); layout({kind:'close',tabId});
    if (pane.floating || pane.tabs.length > 1) layout({kind:'split',tabId});
    layout({kind:pane.floating?'dock':'float',tabId});
    for (const other of state.layout.panes) if (other.id !== pane.id) layout({kind:'move',tabId,paneId:other.id});
    const view = state.views[tabId];
    if (!view || view.restoring) continue;
    actions.push({operation:'reload',event:'click',args:[tabId]});
    const snapshot = view.snapshot;
    if (!snapshot || !['ready','empty'].includes(snapshot.state.status)) continue;
    if (snapshot.view.kind === 'detail') actions.push({operation:'reading',event:'click',args:[tabId]});
    for (const action of snapshot.actions) {
      if (!action.enabled) continue;
      const ids = action.id === 'inspect' || action.id === 'open-diff' ? snapshot.view.kind === 'collection' ? snapshot.view.items.map(item=>item.id) : [] : [null];
      for (const id of ids) actions.push({operation:'semantic',event:'click',args:[tabId,JSON.stringify(actionMessage(snapshot,action.id,id))]});
    }
  }
  return actions;
}
export function createSidebarDirectory() {
  const directory = createActionDirectory<Spec>('sidebar');
  return {
    project: (state: PresentationSidebar, scope: string) => directory.project(sidebarActions(state), scope),
    resolve: (state: PresentationSidebar, scope: string, context: PresentationContext, intent: PresentationIntent) => directory.resolve(sidebarActions(state),scope,context,intent),
  };
}
