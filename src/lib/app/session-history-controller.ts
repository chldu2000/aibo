import type { Session, SessionHistoryCursor, SessionHistoryPage } from '../types';
import { toErrorMessage } from './error-utils';
export type SessionHistoryState = {
  sessions: Session[]; selectedId: string | null; page: SessionHistoryPage | null;
  loading: boolean; error: string | null; pageNumber: number;
};
export const emptySessionHistory = (): SessionHistoryState => ({ sessions: [], selectedId: null, page: null, loading: false, error: null, pageNumber: 1 });
export function createSessionHistoryController(ports: {
  list(workspaceId: string): Promise<Session[]>;
  read(workspaceId: string, sessionId: string, before: SessionHistoryCursor | null): Promise<SessionHistoryPage>;
  publish(state: SessionHistoryState): void;
}) {
  type View = { workspaceId: string; state: SessionHistoryState; revision: number; before: SessionHistoryCursor | null; back: (SessionHistoryCursor | null)[] };
  let current: View | undefined;
  const publish = (view: View) => { if (current === view) ports.publish({ ...view.state }); };
  async function read(view: View): Promise<void> {
    const id = view.state.selectedId; if (!id) return;
    const revision = ++view.revision;
    view.state = { ...view.state, loading: true, error: null, pageNumber: view.back.length + 1 }; publish(view);
    try {
      const page = await ports.read(view.workspaceId, id, view.before);
      if (current !== view || view.revision !== revision) return;
      if (page.schema !== 'aibo.session-history-page/v1' || page.source !== 'persisted-core' || page.session.workspaceId !== view.workspaceId || page.session.id !== id || page.items.some(item => item.sessionId !== id)) throw Error('历史响应与当前会话不匹配');
      view.state = { ...view.state, page, sessions: view.state.sessions.map(session => session.id === id ? page.session : session) };
    } catch (error) { if (current === view && view.revision === revision) view.state.error = toErrorMessage(error); }
    finally { if (current === view && view.revision === revision) { view.state.loading = false; publish(view); } }
  }
  return {
    close() { current = undefined; },
    async open(workspaceId: string, preferredId: string | null = null): Promise<void> {
      const view: View = { workspaceId, state: { ...emptySessionHistory(), loading: true }, revision: 0, before: null, back: [] }; current = view; publish(view);
      try {
        const sessions = await ports.list(workspaceId);
        if (current !== view) return;
        view.state.sessions = sessions.filter(session => session.workspaceId === workspaceId);
        view.state.selectedId = view.state.sessions.find(session => session.id === preferredId)?.id ?? view.state.sessions[0]?.id ?? null;
        view.state.loading = false; publish(view); await read(view);
      } catch (error) { if (current === view) { view.state.loading = false; view.state.error = toErrorMessage(error); publish(view); } }
    },
    async select(id: string): Promise<void> {
      const view = current; if (!view || !view.state.sessions.some(session => session.id === id)) return;
      view.before = null; view.back = []; view.state.selectedId = id; view.state.page = null; await read(view);
    },
    refresh(): Promise<void> { return current ? read(current) : Promise.resolve(); },
    older(): Promise<void> {
      const view = current; const before = view?.state.page?.nextBefore;
      if (!view || view.state.loading || !before) return Promise.resolve();
      view.back.push(view.before); view.before = before; view.state.page = null; return read(view);
    },
    newer(): Promise<void> {
      const view = current; if (!view || view.state.loading || !view.back.length) return Promise.resolve();
      view.before = view.back.pop() ?? null; view.state.page = null; return read(view);
    },
    latest(): Promise<void> { const view = current; if (!view) return Promise.resolve(); view.back = []; view.before = null; view.state.page = null; return read(view); },
  };
}
