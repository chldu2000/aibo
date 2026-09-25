import type { Session } from '$lib/types';

type Ports = {
  prepare: (workspaceId: string, agentId: string, installationId: string) => Promise<Session>;
  start: (sessionId: string) => Promise<Session>;
  getWorkspaceId: () => string | null;
  getSessionId: () => string | null;
  findSession: (id: string) => Session | null;
  putSession: (session: Session) => void;
  selectSession: (id: string) => void;
  setCreating: (creating: boolean) => void;
  setError: (message: string | null) => void;
  setNotice: (message: string) => void;
  refreshProfile: (id: string) => void | Promise<void>;
};

/** Native startup outlives navigation, but never owns the user's selection or draft. */
export function createSessionStartupController(ports: Ports) {
  return {
    async create(workspaceId: string, agentId: string, installationId: string): Promise<void> {
      let session: Session;
      const previousSelection = ports.getSessionId();
      ports.setCreating(true);
      ports.setError(null);
      try {
        session = await ports.prepare(workspaceId, agentId, installationId);
        ports.putSession(session);
        if (ports.getWorkspaceId() === workspaceId && ports.getSessionId() === previousSelection) {
          ports.selectSession(session.id);
          ports.setNotice('会话正在初始化，可以先编写消息。');
        }
      } catch (error) {
        if (ports.getWorkspaceId() === workspaceId) ports.setError(String(error));
        return;
      } finally { ports.setCreating(false); }
      try {
        const ready = await ports.start(session.id);
        const current = ports.findSession(session.id);
        if (!current || current.archived || current.state === 'closed') return;
        if (current.state === 'starting') ports.putSession({...ready, label: current.label});
        if (ports.getSessionId() === session.id) {
          void ports.refreshProfile(session.id);
          ports.setNotice('会话已就绪，可以发送消息。');
        }
      } catch (error) {
        const current = ports.findSession(session.id);
        if (!current || current.archived || current.state === 'closed') return;
        if (current.state === 'starting') ports.putSession({...current, state:'failed'});
        if (ports.getSessionId() === session.id) ports.setError(`会话初始化失败：${String(error)}`);
      }
    },
  };
}
