import type { AgentCommand } from '$lib/types';

/**
 * Commands handled by Aibo itself for embedded Pi sessions.
 * Dynamic Pi extension/skill commands are loaded from the host at runtime.
 */
export const AIBO_PI_COMMANDS: AgentCommand[] = [
  { name: 'settings', description: '打开 Aibo 设置', source: 'builtin', category: 'agent', execution: 'aibo', agent: 'pi' },
  { name: 'new', description: '新建 Pi 会话', source: 'builtin', category: 'agent', execution: 'aibo', agent: 'pi' },
  { name: 'name', description: '查看或修改当前会话名称', source: 'builtin', category: 'agent', execution: 'aibo', agent: 'pi' },
  { name: 'trust', description: '切换当前工作区信任状态', source: 'builtin', category: 'agent', execution: 'aibo', agent: 'pi' },
  { name: 'tree', description: '刷新并查看当前会话树', source: 'builtin', category: 'agent', execution: 'aibo', agent: 'pi' },
  { name: 'session', description: '查看当前会话信息', source: 'builtin', category: 'agent', execution: 'aibo', agent: 'pi' },
  { name: 'resume', description: '刷新会话并回到当前工作区', source: 'builtin', category: 'agent', execution: 'aibo', agent: 'pi' },
  { name: 'compact', description: '压缩当前会话上下文', source: 'builtin', category: 'agent', execution: 'adapter', agent: 'pi' },
  { name: 'model', description: '查看或切换当前模型', source: 'builtin', category: 'agent', execution: 'adapter', agent: 'pi' },
  { name: 'thinking', description: '查看或设置推理强度', source: 'builtin', category: 'agent', execution: 'adapter', agent: 'pi' },
  { name: 'reload', description: '重新加载会话资源', source: 'builtin', category: 'agent', execution: 'adapter', agent: 'pi' },
];

/**
 * Commands handled by Aibo itself for Codex sessions. They intentionally
 * mirror the existing command-palette actions rather than being sent to the
 * Codex model as plain text.
 */
export const AIBO_CODEX_COMMANDS: AgentCommand[] = [
  { name: 'settings', description: '打开 Aibo 设置', source: 'builtin', category: 'agent', execution: 'aibo', agent: 'codex' },
  { name: 'new', description: '新建 Codex 会话', source: 'builtin', category: 'agent', execution: 'aibo', agent: 'codex' },
  { name: 'name', description: '查看或修改当前会话名称', source: 'builtin', category: 'agent', execution: 'aibo', agent: 'codex' },
  { name: 'trust', description: '切换当前工作区信任状态', source: 'builtin', category: 'agent', execution: 'aibo', agent: 'codex' },
  { name: 'tree', description: '刷新当前 Codex 线程', source: 'builtin', category: 'agent', execution: 'aibo', agent: 'codex' },
  { name: 'session', description: '查看当前会话信息', source: 'builtin', category: 'agent', execution: 'aibo', agent: 'codex' },
  { name: 'resume', description: '刷新当前 Codex 线程', source: 'builtin', category: 'agent', execution: 'aibo', agent: 'codex' },
  { name: 'fork', description: '从当前会话创建分支', source: 'builtin', category: 'agent', execution: 'aibo', agent: 'codex' },
  { name: 'archive', description: '归档当前会话', source: 'builtin', category: 'agent', execution: 'aibo', agent: 'codex' },
  { name: 'model', description: '查看或切换当前模型', source: 'builtin', category: 'agent', execution: 'adapter', agent: 'codex' },
  { name: 'thinking', description: '查看或设置推理强度', source: 'builtin', category: 'agent', execution: 'adapter', agent: 'codex' },
  { name: 'plan', description: '切换到只读计划模式', source: 'builtin', category: 'agent', execution: 'aibo', agent: 'codex' },
  { name: 'goal', description: '查看、设置或清除当前目标', source: 'builtin', category: 'agent', execution: 'adapter', agent: 'codex' },
  { name: 'skills', description: '刷新当前工作区 Skills', source: 'builtin', category: 'agent', execution: 'adapter', agent: 'codex' },
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
