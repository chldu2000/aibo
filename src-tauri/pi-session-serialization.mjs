export function textContent(message) {
  const content = Array.isArray(message?.content) ? message.content : [];
  const text = content
    .filter((item) => item?.type === "text")
    .map((item) => item.text ?? "")
    .join("");
  return text
    .replace(/<think(?:ing)?(?:\s[^>]*)?>[\s\S]*?<\/think(?:ing)?>/gi, "")
    .replace(/<\|(?:thinking|reasoning)\|>[\s\S]*?<\|end_(?:thinking|reasoning)\|>/gi, "");
}

function hasThinkingContent(message) {
  const content = Array.isArray(message?.content) ? message.content : [];
  return content.some((item) => {
    const type = String(item?.type ?? "").toLowerCase();
    return type === "thinking" || type === "reasoning" || type === "redacted_thinking" ||
      typeof item?.thinking === "string" || typeof item?.reasoning === "string" ||
      typeof item?.reasoningContent === "string" || typeof item?.reasoning_content === "string";
  });
}

function toolCallNames(message) {
  const content = Array.isArray(message?.content) ? message.content : [];
  return content
    .filter((item) => {
      const type = String(item?.type ?? "").toLowerCase();
      return type === "toolcall" || type === "tool_call" || type === "tooluse" || type === "tool_use";
    })
    .map((item) => item.name ?? item.toolName ?? item.tool_name)
    .filter((name) => typeof name === "string" && name.trim())
    .map((name) => name.trim())
    .slice(0, 3);
}

function messageSummary(message) {
  const text = textContent(message).trim();
  if (text) return text;

  const tools = toolCallNames(message);
  if (tools.length > 0) return `调用工具：${tools.join("、")}`;
  if (hasThinkingContent(message)) return "Agent 思考内容（正文未显示）";

  switch (message?.role) {
    case "assistant":
      return "Agent 回复（无可显示正文）";
    case "user":
      return "用户消息（无可显示正文）";
    case "toolResult":
    case "tool":
      return "工具结果（无可显示正文）";
    default:
      return "消息（无可显示正文）";
  }
}

function treeNodeSummary(entry) {
  const summary = entry.type === "message"
    ? messageSummary(entry.message)
    : entry.type === "compaction" || entry.type === "branch_summary"
      ? entry.summary
      : entry.type === "model_change"
        ? `${entry.provider ?? ""}/${entry.modelId ?? ""}`
        : entry.type === "thinking_level_change"
          ? `推理强度已切换为 ${entry.thinkingLevel ?? "unknown"}`
        : entry.type === "session_info"
          ? entry.name
          : undefined;
  return typeof summary === "string" ? summary.slice(0, 500) : undefined;
}

export function compactTreeNode(node, ancestors = new Set()) {
  const roots = [];
  const stack = [{ node, target: roots, ancestors }];
  while (stack.length > 0) {
    const current = stack.pop();
    const entry = current.node?.entry ?? {};
    const id = typeof entry.id === "string" ? entry.id : null;
    const nextAncestors = new Set(current.ancestors);
    if (id) nextAncestors.add(id);
    const output = {
      id: entry.id,
      parentId: entry.parentId ?? null,
      type: entry.type,
      timestamp: entry.timestamp,
      role: entry.message?.role,
      summary: treeNodeSummary(entry),
      label: current.node?.label,
      children: [],
    };
    current.target.push(output);
    if (!Array.isArray(current.node?.children) || !id || current.ancestors.has(id)) continue;
    for (let index = current.node.children.length - 1; index >= 0; index -= 1) {
      stack.push({
        node: current.node.children[index],
        target: output.children,
        ancestors: nextAncestors,
      });
    }
  }
  return roots[0];
}

export function compactSessionEntry(entry) {
  if (!entry || typeof entry !== "object") return undefined;
  const content = entry.type === "message"
    ? textContent(entry.message)
    : entry.type === "model_change"
      ? `模型已切换为 ${entry.provider ?? ""}/${entry.modelId ?? ""}`
      : entry.type === "thinking_level_change"
        ? `推理强度已切换为 ${entry.thinkingLevel ?? "unknown"}`
        : entry.type === "session_info"
          ? `会话名称已更新为 ${entry.name ?? ""}`
          : typeof entry.summary === "string"
            ? entry.summary
            : typeof entry.content === "string"
              ? entry.content
              : undefined;
  return {
    id: entry.id,
    parentId: entry.parentId ?? null,
    type: entry.type,
    timestamp: entry.timestamp,
    role: entry.message?.role,
    toolName: entry.message?.toolName,
    stopReason: entry.message?.stopReason,
    isError: entry.message?.isError,
    customType: entry.customType,
    display: entry.display,
    summary: content,
    data: entry.data,
  };
}

function entriesFor(manager) {
  return typeof manager?.getEntries === "function" ? manager.getEntries() : [];
}

export function compactActiveBranch(manager) {
  const entries = entriesFor(manager);
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const branch = [];
  const seen = new Set();
  let currentId = manager?.getLeafId?.() ?? null;
  while (currentId && !seen.has(currentId)) {
    seen.add(currentId);
    const entry = byId.get(currentId);
    if (!entry) break;
    branch.push(entry);
    currentId = typeof entry.parentId === "string" ? entry.parentId : null;
  }
  return branch.reverse().map(compactSessionEntry);
}

export function compactSafeTree(manager) {
  const entries = entriesFor(manager);
  const entryIds = new Set(entries.map((entry) => entry.id));
  const parents = new Map(entries.map((entry) => {
    const candidate = typeof entry.parentId === "string" && entry.parentId !== entry.id
      ? entry.parentId
      : null;
    return [entry.id, candidate && entryIds.has(candidate) ? candidate : null];
  }));
  const visited = new Set();
  for (const entry of entries) {
    if (visited.has(entry.id)) continue;
    const path = [];
    const pathIndex = new Map();
    let currentId = entry.id;
    while (currentId && !visited.has(currentId) && !pathIndex.has(currentId)) {
      pathIndex.set(currentId, path.length);
      path.push(currentId);
      currentId = parents.get(currentId) ?? null;
    }
    if (currentId && pathIndex.has(currentId)) {
      // The SDK should never persist a cycle, but a malformed/custom session
      // must not make a tree read recurse forever. Detach one cycle node and
      // retain the rest of the chain for navigation.
      parents.set(currentId, null);
    }
    path.forEach((id) => visited.add(id));
  }

  const nodes = new Map(entries.map((entry) => [entry.id, {
    entry: { ...entry, parentId: parents.get(entry.id) ?? null },
    label: manager?.getLabel?.(entry.id),
    children: [],
  }]));
  const roots = [];
  for (const node of nodes.values()) {
    const parentId = node.entry.parentId;
    const parent = parentId ? nodes.get(parentId) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const compareByTimestamp = (left, right) =>
    new Date(left.entry.timestamp).getTime() - new Date(right.entry.timestamp).getTime();
  const sortStack = [...roots];
  while (sortStack.length > 0) {
    const node = sortStack.pop();
    node.children.sort(compareByTimestamp);
    sortStack.push(...node.children);
  }
  roots.sort(compareByTimestamp);
  return roots.map((node) => compactTreeNode(node));
}
