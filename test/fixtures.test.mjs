import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { assertProbe } from "../probes/lib/probe-output.mjs";

const root = path.resolve(process.cwd());

test("AgentEvent v1 schema is valid JSON with a frozen version", async () => {
  const schema = JSON.parse(
    await readFile(path.join(root, "contracts", "agent-event.v1.schema.json"), "utf8"),
  );
  assert.equal(schema.properties.schemaVersion.const, "1.0");
  assert.ok(schema.$defs.eventType.enum.includes("approval.requested"));
  assert.ok(schema.$defs.sessionState.enum.includes("interrupted"));
});

test("probe assertions fail loudly so a false gate cannot pass", () => {
  assert.doesNotThrow(() => assertProbe(true, "must pass"));
  assert.throws(() => assertProbe(false, "must fail"), /Probe assertion failed: must fail/);
});

for (const fixture of [
  ["codex", "events.redacted.jsonl"],
  ["codex", "events.macos.redacted.jsonl"],
  ["codex", "events.tools.redacted.jsonl"],
  ["codex", "events.recovery.redacted.jsonl"],
  ["codex", "lifecycle.redacted.jsonl"],
  ["pi", "events.redacted.jsonl"],
  ["pi", "events.macos.redacted.jsonl"],
  ["pi", "session.redacted.jsonl"],
]) {
  test(`fixture ${fixture.join("/")} contains valid LF-delimited JSON`, async () => {
    const contents = await readFile(path.join(root, "fixtures", ...fixture), "utf8");
    assert.equal(contents.includes("\r"), false);
    const lines = contents.trimEnd().split("\n");
    assert.ok(lines.length > 0);
    for (const line of lines) assert.doesNotThrow(() => JSON.parse(line));
  });
}

test("Codex tool fixture replays a normalized item lifecycle", async () => {
  const contents = await readFile(
    path.join(root, "fixtures", "codex", "events.tools.redacted.jsonl"),
    "utf8",
  );
  const events = contents
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line).payload);
  assert.deepEqual(
    events.filter((event) => event.method).map((event) => event.method),
    [
      "thread/started",
      "turn/started",
      "item/started",
      "item/commandExecution/outputDelta",
      "item/updated",
      "item/completed",
      "turn/tokenUsage/updated",
      "turn/completed",
    ],
  );
  const itemIds = events
    .filter((event) => event.params?.itemId || event.params?.item?.id)
    .map((event) => event.params.itemId ?? event.params.item.id);
  assert.deepEqual([...new Set(itemIds)], ["tool-1"]);
  assert.equal(
    events.find((event) => event.method === "turn/tokenUsage/updated").params.tokenUsage.total.totalTokens,
    19,
  );
});

test("Codex lifecycle fixture keeps fork/archive/unarchive IDs consistent", async () => {
  const contents = await readFile(
    path.join(root, "fixtures", "codex", "lifecycle.redacted.jsonl"),
    "utf8",
  );
  const records = contents
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line));
  const fork = records.find((record) => record.payload.method === "thread/fork");
  const forkResponse = records.find((record) => record.payload.result?.thread?.forkedFromId);
  assert.equal(fork.payload.params.threadId, forkResponse.payload.result.thread.forkedFromId);
  const unarchive = records.find((record) => record.payload.method === "thread/unarchive");
  const unarchiveResponse = records.find((record) => record.payload.result?.thread?.name);
  assert.equal(unarchive.payload.params.threadId, unarchiveResponse.payload.result.thread.id);
  assert.equal(
    records.find((record) => record.payload.method === "thread/unarchived").payload.params.threadId,
    unarchive.payload.params.threadId,
  );
});

test("Codex recovery fixture makes approval and crash boundaries explicit", async () => {
  const contents = await readFile(
    path.join(root, "fixtures", "codex", "events.recovery.redacted.jsonl"),
    "utf8",
  );
  const records = contents
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line));
  const request = records.find(
    (record) => record.payload.method?.endsWith("requestApproval") && record.payload.id === 43,
  );
  const response = records.find((record) => record.payload.result?.decision);
  const resolved = records.find((record) => record.payload.method === "serverRequest/resolved");
  const crashed = records.find((record) => record.payload.method === "aibo/process-exited");
  assert.equal(request.payload.id, response.payload.id);
  assert.equal(request.payload.params.itemId, "tool-recovery-2");
  assert.equal(resolved.payload.params.requestId, request.payload.id);
  assert.equal(crashed.payload.params.pendingApprovalCount, 1);
  assert.equal(crashed.payload.params.approvalsDiscarded, true);
});
