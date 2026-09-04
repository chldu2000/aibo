const EVENT_TYPES = new Set([
  "session.started",
  "session.state_changed",
  "turn.started",
  "turn.completed",
  "turn.failed",
  "message.delta",
  "message.completed",
  "tool.started",
  "tool.updated",
  "tool.completed",
  "approval.requested",
  "approval.resolved",
  "usage.updated",
  "queue.updated",
  "compaction.started",
  "compaction.completed",
  "retry.started",
  "retry.completed",
  "extension.updated",
  "session.info_changed",
  "adapter.warning",
  "adapter.crashed",
]);

const SESSION_STATES = new Set([
  "created",
  "starting",
  "idle",
  "running",
  "waiting_approval",
  "interrupted",
  "failed",
  "closed",
]);

const IDEMPOTENT_EVENT_TYPES = new Set([
  "session.started",
  "session.state_changed",
  "message.completed",
  "tool.started",
  "tool.completed",
  "approval.requested",
  "approval.resolved",
  "turn.completed",
  "turn.failed",
  "adapter.crashed",
]);

function eventFingerprint(event) {
  if (!IDEMPOTENT_EVENT_TYPES.has(event.type)) return null;
  const itemId = event.correlation?.itemId ?? event.payload?.itemId ?? "";
  const turnId = event.turnId ?? "";
  return `${event.type}|${turnId}|${itemId}|${JSON.stringify(event.payload)}`;
}

function validationError(message) {
  return new Error(`AgentEvent contract violation: ${message}`);
}

export class AgentEventReplay {
  constructor({ agent, workspaceId, sessionId, externalSessionId = null, generationId }) {
    if (!agent || !workspaceId || !sessionId || !generationId) {
      throw new TypeError("agent, workspaceId, sessionId and generationId are required");
    }
    this.agent = agent;
    this.workspaceId = workspaceId;
    this.sessionId = sessionId;
    this.externalSessionId = externalSessionId;
    this.generationId = generationId;
    this.lastSequence = -1;
    this.state = "created";
    this.accepted = [];
    this.ignored = [];
    this.rejected = [];
    this.eventIds = new Set();
    this.fingerprints = new Set();
    this.pendingApprovals = new Set();
  }

  restart(generationId) {
    if (!generationId || generationId === this.generationId) {
      throw new TypeError("restart requires a new generation id");
    }
    this.generationId = generationId;
    this.lastSequence = -1;
    this.state = "starting";
    this.eventIds.clear();
    this.fingerprints.clear();
  }

  accept(event) {
    try {
      this.validateEnvelope(event);
    } catch (error) {
      this.rejected.push({ event, reason: error.message });
      return { accepted: false, reason: "invalid" };
    }

    if (this.eventIds.has(event.eventId)) {
      this.ignored.push({ event, reason: "duplicate_event_id" });
      return { accepted: false, reason: "duplicate_event_id" };
    }
    this.eventIds.add(event.eventId);

    if (event.generationId !== this.generationId) {
      this.ignored.push({ event, reason: "stale_generation" });
      return { accepted: false, reason: "stale_generation" };
    }
    if (event.sequence <= this.lastSequence) {
      this.rejected.push({ event, reason: "non_monotonic_sequence" });
      return { accepted: false, reason: "non_monotonic_sequence" };
    }
    this.lastSequence = event.sequence;

    const fingerprint = eventFingerprint(event);
    if (fingerprint && this.fingerprints.has(fingerprint)) {
      this.ignored.push({ event, reason: "duplicate_event" });
      return { accepted: false, reason: "duplicate_event" };
    }
    if (fingerprint) this.fingerprints.add(fingerprint);

    this.applyState(event);
    this.accepted.push(event);
    return { accepted: true };
  }

  replay(events) {
    for (const event of events) this.accept(event);
    return this.snapshot();
  }

  snapshot() {
    return {
      state: this.state,
      acceptedCount: this.accepted.length,
      ignoredCount: this.ignored.length,
      rejectedCount: this.rejected.length,
      pendingApprovalCount: this.pendingApprovals.size,
      acceptedTypes: this.accepted.map((event) => event.type),
    };
  }

  validateEnvelope(event) {
    if (!event || typeof event !== "object") throw validationError("event must be an object");
    if (event.schemaVersion !== "1.0") throw validationError("schemaVersion must be 1.0");
    if (typeof event.eventId !== "string" || !event.eventId) throw validationError("eventId is required");
    if (typeof event.generationId !== "string" || !event.generationId) throw validationError("generationId is required");
    if (!Number.isInteger(event.sequence) || event.sequence < 0) throw validationError("sequence must be a non-negative integer");
    if (!event.source || event.source.agent !== this.agent) throw validationError("source.agent does not match the replay adapter");
    if (event.workspaceId !== this.workspaceId) throw validationError("workspaceId does not match the replay binding");
    if (event.sessionId !== this.sessionId) throw validationError("sessionId does not match the replay binding");
    if (this.externalSessionId !== null && event.externalSessionId !== this.externalSessionId) {
      throw validationError("externalSessionId does not match the replay binding");
    }
    if (!EVENT_TYPES.has(event.type)) throw validationError(`unsupported event type: ${event.type}`);
    if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) {
      throw validationError("payload must be an object");
    }
  }

  applyState(event) {
    if (event.type === "session.started") {
      this.state = SESSION_STATES.has(event.payload.state) ? event.payload.state : "idle";
      return;
    }
    if (event.type === "session.state_changed") {
      if (SESSION_STATES.has(event.payload.state)) this.state = event.payload.state;
      return;
    }
    if (event.type === "turn.started") {
      this.state = "running";
      return;
    }
    if (event.type === "approval.requested") {
      this.pendingApprovals.add(String(event.correlation?.requestId ?? event.payload.requestId ?? event.eventId));
      this.state = "waiting_approval";
      return;
    }
    if (event.type === "approval.resolved") {
      this.pendingApprovals.delete(String(event.correlation?.requestId ?? event.payload.requestId ?? ""));
      this.state = "running";
      return;
    }
    if (event.type === "adapter.crashed") {
      this.pendingApprovals.clear();
      this.state = "interrupted";
      return;
    }
    if (event.type === "turn.failed") {
      this.state = "failed";
      return;
    }
    if (event.type === "turn.completed") {
      const status = event.payload.status;
      this.state = status === "interrupted" || status === "aborted" ? "interrupted" : status === "failed" ? "failed" : "idle";
    }
  }
}

export function makeAgentEvent({
  agent,
  workspaceId = "fixture-workspace",
  sessionId = "fixture-session",
  externalSessionId = null,
  generationId = "fixture-generation-1",
  sequence,
  type,
  turnId = null,
  payload = {},
  correlation = null,
  eventId = `${generationId}-event-${sequence}`,
  transport = agent === "codex" ? "app-server" : "pi-sdk",
}) {
  return {
    schemaVersion: "1.0",
    eventId,
    generationId,
    sequence,
    occurredAt: "2026-01-01T00:00:00.000Z",
    source: {
      agent,
      transport,
      adapterVersion: "fixture-replay",
      agentVersion: null,
      protocolVersion: null,
    },
    workspaceId,
    sessionId,
    externalSessionId,
    turnId,
    type,
    correlation,
    payload,
    rawRef: null,
  };
}

export function checkCapabilities(advertised, required) {
  const available = new Set(Array.isArray(advertised) ? advertised : []);
  const missing = (Array.isArray(required) ? required : []).filter((capability) => !available.has(capability));
  return { supported: missing.length === 0, missing };
}
