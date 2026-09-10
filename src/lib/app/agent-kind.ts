import type { Session } from '$lib/types';

export type AgentKind = 'codex' | 'pi' | 'plugin';
export type SessionModelBackend = 'pi' | 'plugin' | 'profile';

/** Legacy presentation family only. Capabilities never identify a provider. */
export function sessionAgentKind(
  session: Pick<Session, 'agent' | 'capabilities'> | null | undefined,
): AgentKind {
  if (!session) return 'plugin';
  if (
    session.agent === 'codex'
    || session.agent === 'dev.aibo.codex.agent'
  ) return 'codex';
  if (
    session.agent === 'pi'
    || session.agent === 'dev.aibo.pi.agent'
  ) return 'pi';
  return 'plugin';
}

/** Selects the API that also owns persistence for model and reasoning choices. */
export function sessionModelBackend(
  session: Pick<Session, 'agent' | 'capabilities' | 'pluginInstallationId'>,
): SessionModelBackend {
  if (sessionAgentKind(session) === 'pi') return 'pi';
  return session.pluginInstallationId ? 'plugin' : 'profile';
}
