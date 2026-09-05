import { mkdir } from "node:fs/promises";
import readline from "node:readline";
import process from "node:process";
import { createAgentSession, createBashToolDefinition, createWriteToolDefinition, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";

// The host is intentionally a small, versioned JSONL boundary. Rust owns the
// durable Aibo session; this process owns only one Pi AgentSession at a time.
const HOST_PROTOCOL = "aibo-pi-sdk-host.v1";
let session = null;
let manager = null;
let modelRuntime = null;
let activeTurnId = null;
let unsubscribe = null;
let resumedSession = false;
let nextCoreToolRequestId = 1;
const pendingCoreToolRequests = new Map();

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function respond(id, result) {
  write({ id, result });
}

function fail(id, error) {
  write({ id, error: { code: "pi_sdk_host_error", message: error instanceof Error ? error.message : String(error) } });
}

function requestCoreTool(tool, params) {
  const id = `aibo-tool-${nextCoreToolRequestId++}`;
  return new Promise((resolve, reject) => {
    pendingCoreToolRequests.set(id, { resolve, reject });
    write({
      id,
      method: "aibo/tool-request",
      params: { ...params, tool, turnId: activeTurnId },
    });
  });
}

function consumeCoreToolResponse(message) {
  if (!message || message.method || message.id === undefined) return false;
  const id = String(message.id);
  const pending = pendingCoreToolRequests.get(id);
  if (!pending) return false;
  pendingCoreToolRequests.delete(id);
  if (message.error) {
    pending.reject(new Error(message.error.message ?? String(message.error)));
  } else {
    pending.resolve(message.result ?? null);
  }
  return true;
}

function textContent(message) {
  return (message?.content ?? [])
    .filter((item) => item?.type === "text")
    .map((item) => item.text ?? "")
    .join("");
}

function compactMessage(message) {
  if (!message || typeof message !== "object") return undefined;
  return {
    role: message.role,
    text: textContent(message),
    stopReason: message.stopReason,
  };
}

function compactTreeNode(node) {
  const entry = node?.entry ?? {};
  const message = entry.message;
  const summary = entry.type === "message"
    ? textContent(message)
    : entry.type === "compaction" || entry.type === "branch_summary"
      ? entry.summary
      : entry.type === "model_change"
        ? `${entry.provider ?? ""}/${entry.modelId ?? ""}`
        : entry.type === "session_info"
          ? entry.name
          : undefined;
  return {
    id: entry.id,
    parentId: entry.parentId ?? null,
    type: entry.type,
    timestamp: entry.timestamp,
    role: message?.role,
    summary: summary?.slice(0, 500),
    label: node.label,
    children: Array.isArray(node.children) ? node.children.map(compactTreeNode) : [],
  };
}

function compactSessionEntry(entry) {
  if (!entry || typeof entry !== "object") return undefined;
  const message = entry.message;
  const summary = entry.type === "message"
    ? textContent(message)
    : typeof entry.summary === "string" ? entry.summary : undefined;
  return {
    id: entry.id,
    parentId: entry.parentId ?? null,
    type: entry.type,
    timestamp: entry.timestamp,
    role: message?.role,
    customType: entry.customType,
    display: entry.display,
    summary: summary?.slice(0, 500),
    data: entry.data,
  };
}

function compactEvent(event) {
  const type = event?.type;
  if (!type) return null;
  const compact = { type };
  if (type === "message_start" || type === "message_end") {
    compact.message = compactMessage(event.message);
  } else if (type === "message_update") {
    const update = event.assistantMessageEvent ?? {};
    compact.assistantMessageEvent = {
      type: update.type,
      contentIndex: update.contentIndex,
      delta: update.delta,
      content: update.content,
    };
    if (event.usage) compact.usage = event.usage;
  } else if (type === "turn_end") {
    compact.message = compactMessage(event.message);
    compact.toolResults = Array.isArray(event.toolResults) ? event.toolResults.map((item) => ({
      toolCallId: item.toolCallId,
      toolName: item.toolName,
      isError: item.isError,
      content: item.content,
    })) : [];
  } else if (type === "agent_end") {
    compact.messages = Array.isArray(event.messages) ? event.messages.map(compactMessage) : [];
    compact.willRetry = event.willRetry;
  } else if (type.startsWith("tool_execution_")) {
    compact.toolCallId = event.toolCallId ?? event.id;
    compact.toolName = event.toolName ?? event.name;
    compact.args = event.args;
    compact.result = event.result;
    compact.isError = event.isError;
  } else if (type === "agent_error") {
    compact.error = event.error ?? event.message;
  } else if (type === "queue_update") {
    compact.steering = Array.isArray(event.steering) ? event.steering : [];
    compact.followUp = Array.isArray(event.followUp) ? event.followUp : [];
  } else if (type === "compaction_start") {
    compact.reason = event.reason;
  } else if (type === "compaction_end") {
    compact.reason = event.reason;
    compact.aborted = event.aborted === true;
    compact.willRetry = event.willRetry === true;
    compact.errorMessage = event.errorMessage;
    if (event.result) {
      compact.result = {
        summary: event.result.summary,
        firstKeptEntryId: event.result.firstKeptEntryId,
        tokensBefore: event.result.tokensBefore,
        estimatedTokensAfter: event.result.estimatedTokensAfter,
        usage: event.result.usage,
        details: event.result.details,
      };
    }
  } else if (type === "auto_retry_start") {
    compact.kind = "agent";
    compact.attempt = event.attempt;
    compact.maxAttempts = event.maxAttempts;
    compact.delayMs = event.delayMs;
    compact.errorMessage = event.errorMessage;
  } else if (type === "auto_retry_end") {
    compact.kind = "agent";
    compact.success = event.success === true;
    compact.attempt = event.attempt;
    compact.finalError = event.finalError;
  } else if (type === "summarization_retry_scheduled") {
    compact.kind = "summarization";
    compact.phase = "scheduled";
    compact.attempt = event.attempt;
    compact.maxAttempts = event.maxAttempts;
    compact.delayMs = event.delayMs;
    compact.errorMessage = event.errorMessage;
  } else if (type === "summarization_retry_attempt_start") {
    compact.kind = "summarization";
    compact.phase = "attempt_start";
    compact.source = event.source;
    compact.reason = event.reason;
  } else if (type === "summarization_retry_finished") {
    compact.kind = "summarization";
    compact.phase = "finished";
  } else if (type === "session_info_changed") {
    compact.name = event.name;
  } else if (type === "entry_appended") {
    compact.entry = compactSessionEntry(event.entry);
  } else if (type === "thinking_level_changed") {
    compact.level = event.level;
  }
  return compact;
}

function emitEvent(event) {
  const compact = compactEvent(event);
  if (!compact) return;
  write({
    method: "aibo/event",
    params: { protocol: HOST_PROTOCOL, turnId: activeTurnId, event: compact },
  });
}

async function start(params) {
  const cwd = String(params?.cwd ?? process.cwd());
  const sessionDir = String(params?.sessionDir ?? "");
  if (!sessionDir) throw new Error("sessionDir is required");
  await mkdir(sessionDir, { recursive: true });

  if (unsubscribe) unsubscribe();
  resumedSession = false;
  if (params?.sessionId) {
    const reopened = await openManager(cwd, sessionDir, String(params.sessionId));
    manager = reopened ?? SessionManager.create(cwd, sessionDir);
    resumedSession = reopened !== null;
  } else {
    manager = SessionManager.create(cwd, sessionDir);
  }
  const enforcedProfile = params?.executionProfile ?? {};
  const workspaceWriteEnabled =
    enforcedProfile.interactionMode === "edit" &&
    enforcedProfile.filesystemPolicy === "workspace-write";
  const commandEnabled = enforcedProfile.interactionMode === "edit" &&
    enforcedProfile.commandPolicy !== "disabled";
  const customTools = [];
  if (workspaceWriteEnabled) customTools.push(createWriteToolDefinition(cwd, {
      operations: {
        // The Core write gateway creates missing parent directories as part of
        // the atomic request, so this hook intentionally does not mutate the
        // host filesystem or create a second approval request.
        mkdir: async () => {},
        writeFile: (absolutePath, content) => requestCoreTool("write_file", {
          path: absolutePath,
          content,
        }),
      },
    }));
  if (commandEnabled) customTools.push(createBashToolDefinition(cwd, {
    operations: {
      exec: async (command, commandCwd, { onData, timeout }) => {
        const result = await requestCoreTool("run_command", {
          command,
          cwd: commandCwd,
          timeout,
        });
        const output = typeof result?.output === "string" ? result.output : "";
        if (output) onData(Buffer.from(output));
        return { exitCode: typeof result?.exitCode === "number" ? result.exitCode : null };
      },
    },
  }));
  const created = await createAgentSession({
    cwd,
    sessionManager: manager,
    // ModelRuntime is the SDK-supported bridge to Pi's auth.json/models-store
    // and is required for OAuth/API-key credentials to be visible to an
    // embedded AgentSession.
    modelRuntime: modelRuntime ??= await ModelRuntime.create(),
    // Pi has no native sandbox. Aibo only exposes custom write/command tools
    // after Core resolves the profile; both operations stay on the JSONL
    // gateway so the host never mutates the workspace directly.
    tools: ["read", "grep", "find", "ls"],
    customTools: customTools.length > 0 ? customTools : undefined,
  });
  session = created.session;
  unsubscribe = session.subscribe(emitEvent);
  return {
    protocol: HOST_PROTOCOL,
    sessionId: session.sessionId,
    sessionFile: session.sessionFile ?? null,
    sessionName: session.sessionManager.getSessionName(),
    resumed: resumedSession,
    capabilities: [
      "streaming",
      "abort",
      "session-tree",
      "session-tree-navigation",
      "session-snapshot",
      "queue-management",
      "read-only-tools",
      ...(workspaceWriteEnabled ? ["workspace-write-gateway"] : []),
      ...(commandEnabled ? ["workspace-command-gateway"] : []),
      ...(enforcedProfile.approvalPolicy === "on-request" ? ["aibo-approval"] : []),
    ],
  };
}

async function openManager(cwd, sessionDir, sessionId) {
  const entries = await SessionManager.list(cwd, sessionDir);
  const match = entries.find((entry) => entry.id === sessionId);
  // A newly-created Pi session has no persisted entry until its first
  // assistant message. In that narrow case start a fresh manager so an Aibo
  // session can still recover after an app restart; persisted sessions always
  // take the native open path and retain their history/tree.
  if (!match) return null;
  return SessionManager.open(match.path, sessionDir, cwd);
}

async function handle(message) {
  if (consumeCoreToolResponse(message)) return;
  const id = message?.id;
  const method = message?.method;
  const params = message?.params ?? {};
  try {
    if (method === "start") {
      respond(id, await start(params));
      return;
    }
    if (!session) throw new Error("Pi SDK session has not been started");
    if (method === "prompt") {
      if (session.isStreaming) throw new Error("Pi session already has an active turn");
      activeTurnId = String(params.turnId ?? "");
      // Return an acknowledgement immediately; stream events continue on the
      // same JSONL channel and the Rust adapter persists them as they arrive.
      void session.prompt(String(params.text ?? "")).catch((error) => {
        emitEvent({ type: "agent_error", error: error instanceof Error ? error.message : String(error) });
      }).finally(() => {
        activeTurnId = null;
      });
      respond(id, { accepted: true, turnId: activeTurnId });
      return;
    }
    if (method === "steer" || method === "followUp") {
      if (!session.isStreaming) throw new Error(`Pi ${method} requires an active turn`);
      const text = String(params.text ?? "").trim();
      if (!text) throw new Error(`Pi ${method} text must not be empty`);
      await session[method](text);
      respond(id, { accepted: true, mode: method, turnId: activeTurnId });
      return;
    }
    if (method === "clearQueue") {
      const cleared = session.clearQueue();
      respond(id, {
        steering: Array.isArray(cleared?.steering) ? cleared.steering : [],
        followUp: Array.isArray(cleared?.followUp) ? cleared.followUp : [],
      });
      return;
    }
    if (method === "abort") {
      await session.abort();
      respond(id, { aborted: true });
      return;
    }
    if (method === "dispose") {
      unsubscribe?.();
      unsubscribe = null;
      session.dispose();
      session = null;
      manager = null;
      respond(id, { disposed: true });
      return;
    }
    if (method === "state") {
      respond(id, { sessionId: session.sessionId, isStreaming: session.isStreaming, sessionFile: session.sessionFile ?? null });
      return;
    }
    if (method === "tree") {
      respond(id, {
        sessionId: session.sessionId,
        leafId: session.sessionManager.getLeafId(),
        tree: session.sessionManager.getTree().map(compactTreeNode),
      });
      return;
    }
    if (method === "navigateTree") {
      if (session.isStreaming) throw new Error("Pi session tree navigation requires an idle session");
      const entryId = String(params.entryId ?? "").trim();
      if (!entryId) throw new Error("Pi tree entryId must not be empty");
      const navigation = await session.navigateTree(entryId, { summarize: false });
      respond(id, {
        ...navigation,
        sessionId: session.sessionId,
        leafId: session.sessionManager.getLeafId(),
      });
      return;
    }
    if (method === "snapshot") {
      respond(id, {
        sessionId: session.sessionId,
        leafId: session.sessionManager.getLeafId(),
        branch: session.sessionManager.getBranch().map(compactSessionEntry),
        tree: session.sessionManager.getTree().map(compactTreeNode),
      });
      return;
    }
    throw new Error(`Unknown Pi SDK host method: ${method}`);
  } catch (error) {
    fail(id, error);
  }
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let inFlight = 0;
let inputClosed = false;

function shutdown() {
  unsubscribe?.();
  session?.dispose();
  process.exit(0);
}

input.on("line", (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch (error) {
    write({ method: "aibo/protocol-error", params: { message: error instanceof Error ? error.message : String(error) } });
    return;
  }
  inFlight += 1;
  void handle(message).finally(() => {
    inFlight -= 1;
    if (inputClosed && inFlight === 0) shutdown();
  });
});
input.on("close", () => {
  inputClosed = true;
  if (inFlight === 0) shutdown();
});
