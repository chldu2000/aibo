import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { AgentEventReplay, makeAgentEvent } from "../probes/lib/agent-event-replay.mjs";

const root = path.resolve(process.cwd());

async function fixtureRecords(...parts) {
  const contents = await readFile(path.join(root, "fixtures", ...parts), "utf8");
  return contents.trimEnd().split("\n").map((line) => JSON.parse(line));
}

function codexFixtureEvents(records, {
  workspaceId = "fixture-workspace",
  sessionId = "fixture-codex-session",
  generationId = "fixture-codex-generation",
  externalSessionId: initialExternalSessionId = "thread-fixture",
} = {}) {
  let sequence = 0;
  let externalSessionId = initialExternalSessionId;
  return records.flatMap((record) => {
    const payload = record.payload ?? record;
    const params = payload.params ?? {};
    const thread = params.thread;
    if (thread?.id) externalSessionId = thread.id;
    const turnId = params.turnId ?? params.turn?.id ?? null;
    let type;
    let eventPayload = {};
    let correlation = null;
    switch (payload.method) {
      case "thread/started":
        type = "session.started";
        eventPayload = { state: "idle" };
        break;
      case "turn/started":
        type = "turn.started";
        eventPayload = { status: "running" };
        break;
      case "item/agentMessage/delta":
        type = "message.delta";
        eventPayload = { itemId: params.itemId, delta: params.delta };
        correlation = { itemId: params.itemId };
        break;
      case "item/started":
        type = "tool.started";
        eventPayload = { itemId: params.item?.id, status: "streaming" };
        correlation = { itemId: params.item?.id };
        break;
      case "item/commandExecution/outputDelta":
        type = "tool.updated";
        eventPayload = { itemId: params.itemId, delta: params.delta };
        correlation = { itemId: params.itemId };
        break;
      case "item/updated":
        type = "tool.updated";
        eventPayload = { itemId: params.item?.id, summary: params.item?.aggregatedOutput ?? "" };
        correlation = { itemId: params.item?.id };
        break;
      case "item/completed":
        type = "tool.completed";
        eventPayload = { itemId: params.item?.id, status: "completed" };
        correlation = { itemId: params.item?.id };
        break;
      case "item/commandExecution/requestApproval":
      case "item/fileChange/requestApproval":
        type = "approval.requested";
        eventPayload = { kind: params.kind, availableDecisions: params.availableDecisions };
        correlation = { requestId: payload.id, itemId: params.itemId };
        break;
      case "serverRequest/resolved":
        type = "approval.resolved";
        eventPayload = { requestId: params.requestId };
        correlation = { requestId: params.requestId };
        break;
      case "turn/tokenUsage/updated":
        type = "usage.updated";
        eventPayload = { usage: params.tokenUsage };
        break;
      case "turn/completed":
        type = "turn.completed";
        eventPayload = { status: params.turn?.status === "aborted" ? "interrupted" : params.turn?.status };
        break;
      case "aibo/process-exited":
        type = "adapter.crashed";
        eventPayload = { reason: params.reason, pendingApprovalCount: params.pendingApprovalCount };
        break;
      default:
        return [];
    }
    return [makeAgentEvent({
      agent: "codex",
      workspaceId,
      sessionId,
      externalSessionId,
      generationId,
      sequence: sequence++,
      eventId: `codex-fixture-event-${sequence}`,
      type,
      turnId,
      payload: eventPayload,
      correlation,
    })];
  });
}

function piFixtureEvents(records, {
  workspaceId = "fixture-workspace",
  sessionId = "fixture-pi-session",
  externalSessionId = "pi-session-fixture",
  generationId = "fixture-pi-generation",
} = {}) {
  let sequence = 0;
  return records.flatMap((record) => {
    const payload = record.payload ?? record;
    const params = payload.params ?? record.params ?? {};
    const event = params.event ?? payload.event ?? payload;
    const turnId = params.turnId ?? null;
    let type;
    let eventPayload = {};
    switch (event.type) {
      case "agent_start":
        type = "turn.started";
        eventPayload = { status: "running" };
        break;
      case "message_update":
        if (event.assistantMessageEvent?.type !== "text_delta") return [];
        type = "message.delta";
        eventPayload = { itemId: "pi-fixture-message", delta: event.assistantMessageEvent.delta };
        break;
      case "message_end":
        type = "message.completed";
        eventPayload = { itemId: "pi-fixture-message", text: event.message?.text ?? "" };
        break;
      case "turn_end":
        type = "turn.completed";
        eventPayload = {
          status: ["aborted", "cancelled", "canceled"].includes(event.message?.stopReason)
            ? "interrupted"
            : "completed",
        };
        break;
      case "queue_update":
        type = "queue.updated";
        eventPayload = { steering: event.steering ?? [], followUp: event.followUp ?? [] };
        break;
      case "compaction_start":
        type = "compaction.started";
        eventPayload = { reason: event.reason };
        break;
      case "compaction_end":
        type = "compaction.completed";
        eventPayload = { reason: event.reason, result: event.result ?? null };
        break;
      case "auto_retry_start":
      case "summarization_retry_scheduled":
      case "summarization_retry_attempt_start":
        type = "retry.started";
        eventPayload = { kind: event.type, attempt: event.attempt ?? null };
        break;
      case "auto_retry_end":
      case "summarization_retry_finished":
        type = "retry.completed";
        eventPayload = { kind: event.type, success: event.success ?? true };
        break;
      case "session_info_changed":
        type = "session.info_changed";
        eventPayload = { name: event.name };
        break;
      case "entry_appended":
        type = "extension.updated";
        eventPayload = { entry: event.entry };
        break;
      default:
        return [];
    }
    return [makeAgentEvent({
      agent: "pi",
      workspaceId,
      sessionId,
      externalSessionId,
      generationId,
      sequence: sequence++,
      eventId: `pi-fixture-event-${sequence}`,
      type,
      turnId,
      payload: eventPayload,
      correlation: type === "message.completed" ? { itemId: "pi-fixture-message" } : null,
    })];
  });
}

test("Codex fixture replay preserves tool lifecycle and settles the session", async () => {
  const records = await fixtureRecords("codex", "events.tools.redacted.jsonl");
  const events = codexFixtureEvents(records);
  const replay = new AgentEventReplay({
    agent: "codex",
    workspaceId: "fixture-workspace",
    sessionId: "fixture-codex-session",
    externalSessionId: "thread-tools-1",
    generationId: "fixture-codex-generation",
  });
  const snapshot = replay.replay(events);
  assert.deepEqual(snapshot.acceptedTypes, [
    "session.started",
    "turn.started",
    "tool.started",
    "tool.updated",
    "tool.updated",
    "tool.completed",
    "usage.updated",
    "turn.completed",
  ]);
  assert.equal(snapshot.state, "idle");
  assert.equal(snapshot.rejectedCount, 0);
});

test("Pi fixture replay maps SDK lifecycle into the shared event contract", async () => {
  const records = await fixtureRecords("pi", "sdk-host.events.macos.redacted.jsonl");
  const events = piFixtureEvents(records, { externalSessionId: "pi-session-1" });
  const replay = new AgentEventReplay({
    agent: "pi",
    workspaceId: "fixture-workspace",
    sessionId: "fixture-pi-session",
    externalSessionId: "pi-session-1",
    generationId: "fixture-pi-generation",
  });
  const snapshot = replay.replay(events);
  assert.deepEqual(snapshot.acceptedTypes, [
    "turn.started",
    "message.delta",
    "message.completed",
    "turn.completed",
  ]);
  assert.equal(snapshot.state, "idle");
  assert.equal(snapshot.rejectedCount, 0);
});

test("replay ignores duplicate completions and stale generation events", () => {
  const replay = new AgentEventReplay({
    agent: "codex",
    workspaceId: "workspace-1",
    sessionId: "session-1",
    externalSessionId: "thread-1",
    generationId: "generation-1",
  });
  const completed = makeAgentEvent({
    agent: "codex",
    workspaceId: "workspace-1",
    sessionId: "session-1",
    externalSessionId: "thread-1",
    generationId: "generation-1",
    sequence: 0,
    eventId: "message-completed-1",
    type: "message.completed",
    turnId: "turn-1",
    payload: { itemId: "message-1", text: "done" },
    correlation: { itemId: "message-1" },
  });
  assert.equal(replay.accept(completed).accepted, true);
  assert.equal(replay.accept({ ...completed, eventId: "message-completed-duplicate", sequence: 1 }).reason, "duplicate_event");

  replay.restart("generation-2");
  const stale = { ...completed, eventId: "stale-event", generationId: "generation-1", sequence: 99 };
  assert.equal(replay.accept(stale).reason, "stale_generation");
  const current = makeAgentEvent({
    agent: "codex",
    workspaceId: "workspace-1",
    sessionId: "session-1",
    externalSessionId: "thread-1",
    generationId: "generation-2",
    sequence: 0,
    eventId: "current-event",
    type: "session.state_changed",
    payload: { state: "idle" },
  });
  assert.equal(replay.accept(current).accepted, true);
  assert.equal(replay.snapshot().state, "idle");
  assert.equal(replay.snapshot().ignoredCount, 2);
  assert.equal(replay.snapshot().rejectedCount, 0);
});

test("replay clears pending approvals after adapter crash", async () => {
  const records = await fixtureRecords("codex", "events.recovery.redacted.jsonl");
  const events = codexFixtureEvents(records, {
    sessionId: "fixture-recovery-session",
    externalSessionId: "thread-recovery-1",
  });
  const replay = new AgentEventReplay({
    agent: "codex",
    workspaceId: "fixture-workspace",
    sessionId: "fixture-recovery-session",
    externalSessionId: "thread-recovery-1",
    generationId: "fixture-codex-generation",
  });
  const snapshot = replay.replay(events);
  assert.equal(snapshot.pendingApprovalCount, 0);
  assert.equal(snapshot.state, "running");
  assert.equal(snapshot.rejectedCount, 0);
});
