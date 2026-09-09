import type { Session } from '$lib/types';

export type AgentKind = 'codex' | 'pi' | 'plugin';

/** Maps runtime identities to the semantic presentation/behavior family negotiated by capabilities. */
export function sessionAgentKind(
  session: Pick<Session, 'agent' | 'capabilities'> | null | undefined,
): AgentKind {
  if (!session) return 'plugin';
  if (
    session.agent === 'codex'
    || session.agent === 'dev.aibo.codex.agent'
    || session.capabilities.includes('permissions.nativeSandbox')
  ) return 'codex';
  if (
    session.agent === 'pi'
    || session.agent === 'dev.aibo.pi.agent'
    || session.capabilities.includes('session.tree')
    || session.capabilities.includes('queue.manage')
  ) return 'pi';
  return 'plugin';
}
