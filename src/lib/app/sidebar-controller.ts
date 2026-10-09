import { changeSidebarLayout, defaultSidebarLayout, restoreSidebarLayout, sidebarTabId, type SidebarLayout, type SidebarOperation, type SidebarTarget } from './sidebar-layout.ts';
import { createInstalledWorkbenchController, emptyInstalledWorkbench, type InstalledWorkbenchState } from './installed-workbench-controller.ts';
import type { InstalledContribution, InstalledPort, InstalledScope } from '../presentation/installed-controller.ts';
import type { ViewStateStore } from './view-state-storage.ts';

export type SidebarState = { layout: SidebarLayout; views: Record<string, InstalledWorkbenchState> };
export const emptySidebar = (): SidebarState => ({ layout: defaultSidebarLayout(), views: {} });
type Scope = { workspaceId: string | null; sessionId: string | null };
type Storage = { getItem(key: string): string | null; setItem(key: string, value: string): void };

/** One host owner for layout and plugin leases, independent of any skin or mounted pane. */
export function createSidebarController(options: {
  windowId: string; storage: Storage | null; port: InstalledPort; viewState: ViewStateStore;
  initialView?: 'git' | 'context';
  publish(state: SidebarState): void;
}) {
  let scope: Scope = { workspaceId: null, sessionId: null }, identity = '', disposed = false;
  let state = emptySidebar(), catalog: InstalledContribution[] = [];
  const memory = new Map<string, SidebarLayout>();
  const controllers = new Map<string, ReturnType<typeof createInstalledWorkbenchController>>();
  const key = () => `aibo.sidebar.v1.${encodeURIComponent(options.windowId)}.${encodeURIComponent(identity)}`;
  const publish = () => { if (!disposed) options.publish(state); };
  const save = () => {
    memory.set(identity, state.layout);
    try { options.storage?.setItem(key(), JSON.stringify(state.layout)); } catch { /* Live layout remains available. */ }
  };
  function contribution(target: SidebarTarget) {
    return target.kind === 'plugin' ? catalog.find(item => item.installationId === target.installationId && item.contributionId === target.contributionId) : undefined;
  }
  function available(item: InstalledContribution) {
    return item.available && ((item.scope ?? 'workspace') !== 'workspace' || !!scope.workspaceId)
      && (item.scope !== 'session' || !!scope.sessionId)
      && (item.visibility !== 'workspaceSelected' || !!scope.workspaceId)
      && (item.visibility !== 'sessionSelected' || !!scope.sessionId);
  }
  function reconcile() {
    for (const [id, controller] of controllers) {
      const tab = state.layout.tabs.find(value => value.id === id), item = tab && contribution(tab.target);
      if (!item || !available(item)) {
        controllers.delete(id); controller.dispose();
        const views = { ...state.views }; delete views[id]; state = { ...state, views };
      }
    }
    for (const tab of state.layout.tabs) {
      const item = contribution(tab.target);
      if (!item || !available(item) || controllers.has(tab.id)) continue;
      const currentIdentity = identity;
      const scopedViewState: ViewStateStore = {
        read: value => options.viewState.read({...value, contributionId: JSON.stringify(['sidebar', currentIdentity, value.contributionId])}),
        write: (value, view) => options.viewState.write({...value, contributionId: JSON.stringify(['sidebar', currentIdentity, value.contributionId])}, view),
      };
      const controller = createInstalledWorkbenchController(options.port, scopedViewState, value => {
        if (disposed || identity !== currentIdentity || controllers.get(tab.id) !== controller) return;
        state = { ...state, views: { ...state.views, [tab.id]: value } }; publish();
      });
      controllers.set(tab.id, controller);
      const installedScope: InstalledScope = item.scope === 'application' ? { kind: 'application' }
        : item.scope === 'session' ? { kind: 'session', id: scope.sessionId! } : { kind: 'workspace', id: scope.workspaceId! };
      void controller.open(scope.workspaceId ?? '', item, installedScope);
    }
    publish();
  }
  return {
    setContext(next: Scope) {
      if (disposed) return;
      const nextIdentity = JSON.stringify([next.workspaceId, next.sessionId]);
      if (identity === nextIdentity) return;
      if (identity) save();
      for (const controller of controllers.values()) controller.dispose();
      controllers.clear(); identity = nextIdentity; scope = next;
      let layout = memory.get(identity);
      if (!layout) {
        try {
          const stored = options.storage?.getItem(key());
          layout = stored ? restoreSidebarLayout(JSON.parse(stored)) : changeSidebarLayout(defaultSidebarLayout(), {kind:'focus',tabId:options.initialView ?? 'git'});
        }
        catch { layout = defaultSidebarLayout(); }
      }
      state = { layout, views: {} }; reconcile();
    },
    setCatalog(items: InstalledContribution[]) { if (!disposed) { catalog = items; reconcile(); } },
    apply(operation: SidebarOperation) {
      if (disposed) return;
      if (operation.kind === 'open' && operation.target.kind === 'plugin') {
        const item = contribution(operation.target); if (!item || !available(item)) return;
      }
      state = { ...state, layout: changeSidebarLayout(state.layout, operation) }; save(); reconcile();
    },
    view(id: string) { return state.views[id] ?? emptyInstalledWorkbench(); },
    controller(id: string) { return controllers.get(id); },
    openPlugin(item: InstalledContribution) {
      this.apply({ kind: 'open', target: { kind: 'plugin', installationId: item.installationId, contributionId: item.contributionId } });
      return sidebarTabId({ kind: 'plugin', installationId: item.installationId, contributionId: item.contributionId });
    },
    dispose() { if (disposed) return; save(); disposed = true; for (const controller of controllers.values()) controller.dispose(); controllers.clear(); },
  };
}
