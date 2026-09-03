import { mkdir } from "node:fs/promises";
import readline from "node:readline";
import process from "node:process";
import { createAgentSession, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";

// The host is intentionally a small, versioned JSONL boundary. Rust owns the
// durable Aibo session; this process owns only one Pi AgentSession at a time.
const HOST_PROTOCOL = "aibo-pi-sdk-host.v1";
let session = null;
let manager = null;
let modelRuntime = null;
let activeTurnId = null;
let unsubscribe = null;
let resumedSession = false;

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function respond(id, result) {
  write({ id, result });
}

function fail(id, error) {
  write({ id, error: { code: "pi_sdk_host_error", message: error instanceof Error ? error.message : String(error) } });
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
  const created = await createAgentSession({
    cwd,
    sessionManager: manager,
    // ModelRuntime is the SDK-supported bridge to Pi's auth.json/models-store
    // and is required for OAuth/API-key credentials to be visible to an
    // embedded AgentSession.
    modelRuntime: modelRuntime ??= await ModelRuntime.create(),
    // Pi has no native sandbox. Aibo deliberately limits this first vertical
    // slice to read-only tools; write/command tools are not exposed here.
    tools: ["read", "grep", "find", "ls"],
  });
  session = created.session;
  unsubscribe = session.subscribe(emitEvent);
  return {
    protocol: HOST_PROTOCOL,
    sessionId: session.sessionId,
    sessionFile: session.sessionFile ?? null,
    sessionName: session.sessionManager.getSessionName(),
    resumed: resumedSession,
    capabilities: ["streaming", "abort", "session-tree", "read-only-tools"],
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
