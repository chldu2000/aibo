import type { CapabilitySession } from '../agent-facade';
import { sessionAgentKind } from './agent-kind';
/** Frozen built-in slash vocabularies, independent of capability/transport routing. */
export async function dispatchBuiltinCommand(session: CapabilitySession | null, input: string, handlers: {
  codex(input: string): Promise<boolean>;
  pi(input: string): Promise<boolean>;
}): Promise<boolean> {
  const kind = sessionAgentKind(session);
  return kind === 'plugin' ? false : handlers[kind](input);
}
