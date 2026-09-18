import type { AgentCommand, Session, SessionAccessMode } from '$lib/types';

// Host commands are selected from negotiated session capabilities. Plugin commands
// already belong to the bound provider; their insertion syntax is provider data.
const COMMANDS: Array<[string, string, string[]]> = [
  ['settings', '打开 Aibo 设置', []], ['new', '新建会话', []],
  ['name', '查看或修改会话名称', []], ['trust', '切换工作区信任状态', []],
  ['session', '查看会话信息', []], ['resume', '刷新会话', []],
  ['archive', '归档会话', []],
  ['tree', '查看会话树或刷新远端会话', ['session.tree', 'session.snapshot']],
  ['fork', '从当前会话创建分支', ['session.fork']],
  ['compact', '压缩上下文', ['compaction.run']],
  ['model', '查看或切换模型', ['model.select']],
  ['thinking', '查看或设置推理强度', ['model.reasoning']],
  ['reload', '重新加载会话资源', ['session.reload']],
  ['goal', '查看、设置或清除目标', ['goal.manage']],
  ['skills', '刷新 Skills', ['skill.list', 'command.list']],
];

export function sessionBuiltinCommands(session: Pick<Session, 'capabilities' | 'pluginInstallationId'> | null, accessModes: readonly SessionAccessMode[] = []): AgentCommand[] {
  if (!session?.pluginInstallationId) return [];
  const commands: AgentCommand[] = COMMANDS.filter(([, , required]) => !required.length || required.some(capability => session.capabilities.includes(capability)))
    .map(([name, description]) => ({ name, description, source: 'builtin', category: 'agent', execution: 'aibo' as const }));
  if (accessModes.includes('plan')) commands.push({name: 'plan', description: '切换计划模式', source: 'builtin', category: 'agent', execution: 'aibo'});
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
