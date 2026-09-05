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
  assert.ok(schema.$defs.eventType.enum.includes("compaction.completed"));
  assert.ok(schema.$defs.eventType.enum.includes("retry.started"));
  assert.ok(schema.$defs.eventType.enum.includes("extension.updated"));
  assert.ok(schema.$defs.sessionState.enum.includes("interrupted"));
});

test("Execution Profile v1 schema keeps requested and enforced policy separate", async () => {
  const schema = JSON.parse(
    await readFile(path.join(root, "contracts", "execution-profile.v1.schema.json"), "utf8"),
  );
  assert.equal(schema.properties.schema.const, "aibo.execution-profile/v1");
  assert.deepEqual(schema.properties.interactionMode.enum, ["ask", "plan", "edit"]);
  assert.deepEqual(schema.$defs.resolved.required.slice(0, 3), [
    "schema",
    "requested",
    "enforced",
  ]);
  assert.equal(schema.$defs.resolved.properties.nativeSandbox.type, "boolean");
});

test("Turn ChangeSet v1 schema freezes per-turn file attribution fields", async () => {
  const schema = JSON.parse(
    await readFile(path.join(root, "contracts", "turn-changeset.v1.schema.json"), "utf8"),
  );
  assert.equal(schema.properties.schema.const, "aibo.turn-changeset/v1");
  assert.deepEqual(schema.properties.attribution.enum, ["agent", "mixed", "unknown"]);
  assert.deepEqual(schema.properties.captureStatus.enum, ["captured", "partial", "failed"]);
  assert.ok(schema.required.includes("commands"));
  assert.ok(schema.required.includes("verification"));
  assert.ok(schema.$defs.fileChange.required.includes("baselineHash"));
  assert.ok(schema.$defs.fileChange.required.includes("baselineDirty"));
  assert.ok(schema.$defs.fileChange.required.includes("previousPath"));
  assert.ok(schema.$defs.fileChange.properties.kind.enum.includes("renamed"));
});

test("Context Attachment v1 schema freezes workspace-relative references", async () => {
  const schema = JSON.parse(
    await readFile(path.join(root, "contracts", "context-attachment.v1.schema.json"), "utf8"),
  );
  assert.equal(schema.properties.schema.const, "aibo.context-attachment/v1");
  assert.deepEqual(schema.properties.source.enum, ["picker", "drop", "manual"]);
  assert.deepEqual(schema.properties.sendStrategy.enum, ["reference", "inline"]);
  assert.match(schema.properties.path.pattern, /\\\.\\\./);
});

test("Artifact v1 schema freezes content-addressed metadata", async () => {
  const schema = JSON.parse(
    await readFile(path.join(root, "contracts", "artifact.v1.schema.json"), "utf8"),
  );
  assert.equal(schema.properties.schema.const, "aibo.artifact/v1");
  assert.ok(schema.required.includes("contentHash"));
  assert.ok(schema.required.includes("storagePath"));
  assert.match(schema.properties.contentHash.pattern, /sha256/);
});

test("Checkpoint v1 schema freezes restart-safe baseline metadata", async () => {
  const schema = JSON.parse(
    await readFile(path.join(root, "contracts", "checkpoint.v1.schema.json"), "utf8"),
  );
  assert.equal(schema.properties.schema.const, "aibo.checkpoint/v1");
  assert.ok(schema.required.includes("storagePath"));
  assert.ok(schema.required.includes("fileExists"));
  assert.ok(schema.required.includes("baselineDirty"));
  assert.match(schema.properties.path.pattern, /\\\.\\\./);
});

test("Restore operation v1 schema keeps recovery audit outcomes structured", async () => {
  const schema = JSON.parse(
    await readFile(path.join(root, "contracts", "restore-operation.v1.schema.json"), "utf8"),
  );
  assert.equal(schema.properties.schema.const, "aibo.restore-operation/v1");
  assert.deepEqual(schema.properties.status.enum, ["completed", "blocked", "failed"]);
  assert.ok(schema.required.includes("restored"));
  assert.ok(schema.required.includes("conflicts"));
  assert.ok(schema.required.includes("unsupported"));
});

test("Project action contracts keep execution argv structured", async () => {
  const action = JSON.parse(await readFile(path.join(root, "contracts", "project-action.v1.schema.json"), "utf8"));
  const run = JSON.parse(await readFile(path.join(root, "contracts", "project-action-run.v1.schema.json"), "utf8"));
  assert.equal(action.properties.schema.const, "aibo.project-action/v1");
  assert.deepEqual(action.properties.kind.enum, ["test", "lint", "build", "custom"]);
  assert.equal(action.properties.args.type, "array");
  assert.equal(run.properties.schema.const, "aibo.project-action-run/v1");
});

test("rendered Markdown stays in the safe component path", async () => {
  const renderer = await readFile(
    path.join(root, "src", "lib", "components", "app", "MarkdownContent.svelte"),
    "utf8",
  );
  assert.doesNotMatch(renderer, /\{@html/);
  assert.match(renderer, /SAFE_LINK/);
  assert.match(renderer, /https\?:\\\/\\\//);
  assert.match(renderer, /rel="noreferrer"/);
  assert.match(renderer, /navigator\.clipboard/);
  assert.match(renderer, /复制/);
});

test("command palette is wired through the UI kit seam", async () => {
  const palette = await readFile(
    path.join(root, "src", "lib", "components", "app", "CommandPalette.svelte"),
    "utf8",
  );
  assert.match(palette, /from '\$lib\/ui-kit'/);
  assert.match(palette, /ArrowDown/);
  assert.match(palette, /role="listbox"/);
});

test("workspace capability checker exposes resource inventory without config contents", async () => {
  const inspector = await readFile(
    path.join(root, "src", "lib", "components", "app", "Inspector.svelte"),
    "utf8",
  );
  const api = await readFile(path.join(root, "src", "lib", "api.ts"), "utf8");
  assert.match(inspector, /workspaceCapabilities/);
  assert.match(inspector, /工作区能力/);
  assert.match(inspector, /mcpServers/);
  assert.match(inspector, /恢复记录/);
  assert.match(api, /inspect_workspace_capabilities/);
  assert.doesNotMatch(inspector, /apiKey|accessToken|clientSecret/);
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
  ["pi", "sdk-host.events.macos.redacted.jsonl"],
  ["pi", "sdk-host.lifecycle.macos.redacted.jsonl"],
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

test("Pi SDK host fixture keeps the versioned stream and turn binding intact", async () => {
  const contents = await readFile(
    path.join(root, "fixtures", "pi", "sdk-host.events.macos.redacted.jsonl"),
    "utf8",
  );
  const records = contents.trimEnd().split("\n").map((line) => JSON.parse(line));
  assert.equal(records[0].result.protocol, "aibo-pi-sdk-host.v1");
  const events = records.filter((record) => record.method === "aibo/event");
  assert.ok(events.length >= 4);
  assert.ok(events.every((record) => record.params.protocol === "aibo-pi-sdk-host.v1"));
  assert.deepEqual(
    events.map((record) => record.params.event.type),
    ["agent_start", "message_start", "message_update", "message_end", "turn_end"],
  );
  assert.ok(events.every((record) => record.params.turnId === "pi-turn-1"));
  assert.equal(events[2].params.event.assistantMessageEvent.delta, "hello");
  const tree = records.find((record) => record.result?.tree)?.result;
  assert.equal(tree.sessionId, "pi-session-1");
  assert.equal(tree.leafId, "entry-2");
  assert.equal(tree.tree[0].children[0].role, "assistant");
});

test("Pi SDK host lifecycle fixture preserves compaction, retry, and extension fields", async () => {
  const contents = await readFile(
    path.join(root, "fixtures", "pi", "sdk-host.lifecycle.macos.redacted.jsonl"),
    "utf8",
  );
  const records = contents.trimEnd().split("\n").map((line) => JSON.parse(line));
  const events = records.filter((record) => record.method === "aibo/event");
  assert.deepEqual(
    events.map((record) => record.params.event.type),
    [
      "queue_update",
      "compaction_start",
      "compaction_end",
      "auto_retry_start",
      "auto_retry_end",
      "summarization_retry_scheduled",
      "summarization_retry_attempt_start",
      "summarization_retry_finished",
      "session_info_changed",
      "entry_appended",
    ],
  );
  assert.equal(events[2].params.event.result.tokensBefore, 12000);
  assert.equal(events[3].params.event.attempt, 1);
  assert.equal(events.at(-1).params.event.entry.customType, "probe");
  const navigation = records.find((record) => record.id === "aibo-pi-nav-1")?.result;
  assert.equal(navigation.cancelled, false);
  assert.equal(navigation.leafId, "entry-3");
  const snapshot = records.find((record) => record.id === "aibo-pi-snapshot-1")?.result;
  assert.equal(snapshot.leafId, "entry-3");
  assert.equal(snapshot.branch.length, 2);
});
