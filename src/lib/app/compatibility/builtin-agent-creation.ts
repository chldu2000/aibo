import type { AgentName, ExecutionProfile } from '$lib/types';
/** Built-in picker aliases and initial policies. Remove when the picker uses contribution metadata. */
export function builtinAgentCreation(agent: AgentName): { agentId: string; profile: ExecutionProfile } {
  return { agentId: agent === 'codex' ? 'dev.aibo.codex.agent' : 'dev.aibo.pi.agent', profile: {
    schema: 'aibo.execution-profile/v1', interactionMode: 'ask', approvalPolicy: agent === 'codex' ? 'untrusted' : 'never',
    filesystemPolicy: 'read-only', commandPolicy: agent === 'codex' ? 'approved' : 'disabled', networkPolicy: 'disabled', model: null, reasoningEffort: null,
  } };
}
