import type { TimelineViewItem } from './view-types';

export type TimelineRenderItem =
  | { kind: 'entry'; id: string; item: TimelineViewItem }
  | { kind: 'tool-group'; id: string; items: TimelineViewItem[] }
  | { kind: 'system-group'; id: string; items: TimelineViewItem[] };

export function groupTimelineItems(items: TimelineViewItem[], groupSystemItems = false): TimelineRenderItem[] {
  const grouped: TimelineRenderItem[] = [];
  let toolItems: TimelineViewItem[] = [];
  let systemItems: TimelineViewItem[] = [];

  const flushTools = () => {
    if (toolItems.length === 1) {
      grouped.push({ kind: 'entry', id: toolItems[0].id, item: toolItems[0] });
    } else if (toolItems.length > 1) {
      grouped.push({ kind: 'tool-group', id: `tool-group-${toolItems[0].id}`, items: toolItems });
    }
    toolItems = [];
  };

  const flushSystems = () => {
    if (systemItems.length === 1) {
      grouped.push({ kind: 'entry', id: systemItems[0].id, item: systemItems[0] });
    } else if (systemItems.length > 1) {
      grouped.push({ kind: 'system-group', id: `system-group-${systemItems[0].id}`, items: systemItems });
    }
    systemItems = [];
  };

  for (const item of items) {
    if (item.role === 'tool') {
      flushSystems();
      toolItems.push(item);
    } else if (groupSystemItems && isGroupableSystemItem(item)) {
      flushTools();
      systemItems.push(item);
    } else {
      flushTools();
      flushSystems();
      grouped.push({ kind: 'entry', id: item.id, item });
    }
  }
  flushTools();
  flushSystems();
  return grouped;
}

function isGroupableSystemItem(item: TimelineViewItem): boolean {
  return item.role === 'system'
    && item.entryType !== null
    && item.entryType !== 'branch_summary'
    && item.entryType !== 'compaction';
}

export function toolLabel(item: TimelineViewItem): string {
  const explicitName = item.toolName?.trim();
  const firstLine = item.content
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!explicitName) return truncateToolLabel(firstLine ?? '工具操作');

  const friendlyName: Record<string, string> = {
    commandExecution: '命令执行',
    fileRead: '读取文件',
    fileChange: '修改文件',
    mcpToolCall: 'MCP 工具',
    webSearch: '网页搜索',
  };
  const label = friendlyName[explicitName] ?? explicitName.replace(/([a-z])([A-Z])/g, '$1 $2');
  if (firstLine && firstLine !== explicitName && !firstLine.startsWith('{') && firstLine.length <= 64) {
    return truncateToolLabel(`${label} · ${firstLine}`);
  }
  return truncateToolLabel(label);
}

export function isDiffContent(content: string): boolean {
  return /(^diff --git |^@@ |^\+\+\+ |^--- )/m.test(content);
}

function truncateToolLabel(value: string): string {
  return value.length > 88 ? `${value.slice(0, 85)}…` : value;
}
