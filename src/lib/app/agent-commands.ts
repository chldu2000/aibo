import type { AgentCommand } from '$lib/types';

/**
 * Commands handled by Aibo itself for embedded Pi sessions.
 * Dynamic Pi extension/skill commands are loaded from the host at runtime.
 */
export const AIBO_PI_COMMANDS: AgentCommand[] = [
  { name: 'settings', description: '打开 Aibo 设置', source: 'builtin' },
  { name: 'new', description: '新建 Pi 会话', source: 'builtin' },
  { name: 'name', description: '查看或修改当前会话名称', source: 'builtin' },
  { name: 'trust', description: '切换当前工作区信任状态', source: 'builtin' },
  { name: 'tree', description: '刷新并查看当前会话树', source: 'builtin' },
  { name: 'session', description: '查看当前会话信息', source: 'builtin' },
  { name: 'resume', description: '刷新会话并回到当前工作区', source: 'builtin' },
];

/**
 * Commands handled by Aibo itself for Codex sessions. They intentionally
 * mirror the existing command-palette actions rather than being sent to the
 * Codex model as plain text.
 */
export const AIBO_CODEX_COMMANDS: AgentCommand[] = [
  { name: 'settings', description: '打开 Aibo 设置', source: 'builtin' },
  { name: 'new', description: '新建 Codex 会话', source: 'builtin' },
  { name: 'name', description: '查看或修改当前会话名称', source: 'builtin' },
  { name: 'trust', description: '切换当前工作区信任状态', source: 'builtin' },
  { name: 'tree', description: '刷新当前 Codex 线程', source: 'builtin' },
  { name: 'session', description: '查看当前会话信息', source: 'builtin' },
  { name: 'resume', description: '刷新当前 Codex 线程', source: 'builtin' },
  { name: 'fork', description: '从当前会话创建分支', source: 'builtin' },
  { name: 'archive', description: '归档当前会话', source: 'builtin' },
];

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
