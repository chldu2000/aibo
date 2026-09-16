export interface SubagentEntry {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  toolName: string | null;
  content: string;
  status: 'streaming' | 'completed' | 'failed' | 'interrupted';
}
export interface SubagentTask {
  id: string;
  parentId: string;
  rootTurnId: string;
  name: string;
  task: string;
  activity: string;
  status: 'pending' | 'running' | 'waiting' | 'completed' | 'failed' | 'interrupted' | 'closed' | 'unavailable';
}
export function parseSubagent(content: string): SubagentTask | null {
  try {
    const value = JSON.parse(content);
    return value && ['id','parentId','rootTurnId','name','task','activity','status'].every(key => typeof value[key] === 'string')
      && Object.hasOwn(subagentStatusLabels, value.status) ? value : null;
  } catch { return null; }
}
export const subagentStatusLabels: Record<SubagentTask['status'], string> = {
  pending:'正在启动', running:'运行中', waiting:'等待输入', completed:'已完成', failed:'失败', interrupted:'已中断', closed:'已关闭', unavailable:'过程暂不可用',
};
export function mergeSubagentEntries(history: SubagentEntry[], updates: SubagentEntry[]): SubagentEntry[] {
  const entries = new Map(history.map(entry => [entry.id, entry]));
  for (const entry of updates) entries.set(entry.id, entry);
  return [...entries.values()];
}
