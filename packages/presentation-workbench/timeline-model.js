export function groupTimelineItems(items, groupSystemItems = false) {
  const grouped = [];
  let toolItems = [];
  let systemItems = [];

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
    if (item.toolName === 'subagent') {
      flushTools(); flushSystems();
      grouped.push({ kind: 'entry', id: item.id, item });
    } else if (item.role === 'tool') {
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

function isGroupableSystemItem(item) {
  return item.role === 'system'
    && item.toolName !== 'reasoning'
    && item.entryType !== null
    && item.entryType !== 'branch_summary'
    && item.entryType !== 'compaction';
}

export function toolLabel(item) {
  const explicitName = item.toolName?.trim();
  const firstLine = item.content
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!explicitName) return truncateToolLabel(firstLine ?? '工具操作');

  const friendlyName = {
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

export function isDiffContent(content) {
  return /(^diff --git |^@@ |^\+\+\+ |^--- )/m.test(content);
}

function truncateToolLabel(value) {
  return value.length > 88 ? `${value.slice(0, 85)}…` : value;
}
