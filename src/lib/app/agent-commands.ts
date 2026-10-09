import type { AgentCommand, Session, SessionControl } from '$lib/types';
import { translate } from '../../../packages/i18n/index.js';
import type { Locale } from '../../../packages/i18n/index.js';

// Host commands are selected from negotiated session capabilities. Plugin commands
// already belong to the bound provider; their insertion syntax is provider data.
const COMMANDS = [
  ['settings', []], ['new', []],
  ['name', []], ['trust', []],
  ['session', []], ['resume', []],
  ['archive', []],
  ['tree', ['session.tree', 'session.snapshot']],
  ['fork', ['session.fork']],
  ['compact', ['compaction.run']],
  ['model', ['model.select']],
  ['thinking', ['model.reasoning']],
  ['reload', ['session.reload']],
  ['goal', ['goal.manage']],
  ['skills', ['skill.list', 'command.list']],
] as const;

export function sessionBuiltinCommands(session: Pick<Session, 'capabilities' | 'pluginInstallationId'> | null, controls: readonly SessionControl[] = [], locale: Locale = 'zh-CN'): AgentCommand[] {
  if (!session?.pluginInstallationId) return [];
  const commands: AgentCommand[] = COMMANDS.filter(([, required]) => !required.length || required.some(capability => session.capabilities.includes(capability)))
    .map(([name]) => ({ name, description: translate(locale, `commands.${name}`), source: 'builtin', category: 'agent', execution: 'aibo' as const }));
  for (const control of controls) if (control.command) commands.push({name: control.command, description: control.description || control.label, source: 'builtin', category: 'agent', execution: 'aibo'});
  return commands;
}

export function visibleSessionCommands(builtinCommands: AgentCommand[], discoveredCommands: AgentCommand[]): AgentCommand[] {
  const seen = new Set<string>();
  return [...builtinCommands, ...discoveredCommands].filter(command => {
    if (command.enabled === false) return false;
    const name = command.name.toLocaleLowerCase();
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}

export function commandComposerInsertion(command: AgentCommand): string {
  return command.insertionText ?? '/' + command.name + ' ';
}

export type ParsedAgentCommand = {
  name: string;
  args: string;
};

export function parseAgentCommand(input: string): ParsedAgentCommand | null {
  const match = input.trim().match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
  if (!match) return null;
  return {
    name: match[1].toLocaleLowerCase(),
    args: match[2]?.trim() ?? '',
  };
}
