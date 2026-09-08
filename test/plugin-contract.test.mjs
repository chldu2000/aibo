import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(process.cwd());
const contracts = path.join(root, "contracts");

async function readJson(...segments) {
  return JSON.parse(await readFile(path.join(root, ...segments), "utf8"));
}

async function readJsonl(...segments) {
  const contents = await readFile(path.join(root, ...segments), "utf8");
  assert.equal(contents.includes("\r"), false);
  return contents.trimEnd().split("\n").map((line) => JSON.parse(line));
}

function collectNodes(node, nodes = []) {
  nodes.push(node);
  for (const child of node.children) collectNodes(child, nodes);
  return nodes;
}

function replayEchoLifecycle(records) {
  const pendingRequests = new Map();
  const initializedPhases = new Set();
  const activeTurns = new Set();
  const completedTurns = new Map();
  const textByTurn = new Map();
  const viewRevisions = new Map();
  let resumed = false;

  for (const record of records) {
    assert.ok(["host_to_plugin", "plugin_to_host"].includes(record.direction));
    const message = record.message;
    assert.equal(message.jsonrpc, "2.0");

    if (record.direction === "host_to_plugin") {
      assert.ok("id" in message, `host request in ${record.phase} requires an id`);
      assert.equal(typeof message.method, "string");
      if (!initializedPhases.has(record.phase)) {
        assert.equal(message.method, "aibo.initialize", "initialize must be the first request in a generation");
      }
      pendingRequests.set(message.id, { method: message.method, phase: record.phase, params: message.params });
      if (message.method === "session.resume") {
        assert.equal(message.params.binding.pluginVersion, "1.0.0");
        assert.equal(message.params.binding.recovery.version, 1);
        resumed = true;
      }
      continue;
    }

    if ("id" in message) {
      const request = pendingRequests.get(message.id);
      assert.ok(request, `response ${message.id} must match a request`);
      assert.equal(request.phase, record.phase, `response ${message.id} cannot cross generations`);
      if (message.result?.kind === "initialized") initializedPhases.add(record.phase);
      pendingRequests.delete(message.id);
      continue;
    }

    assert.ok(initializedPhases.has(record.phase), `notifications require initialization in ${record.phase}`);
    assert.ok(["agent/event", "view/render"].includes(message.method));
    assert.equal(message.params.agentId, "dev.aibo.echo.agent");
    assert.equal(message.params.sessionId, "session-1");

    if (message.method === "view/render") {
      const document = message.params.document;
      const previous = viewRevisions.get(document.viewId) ?? -1;
      assert.ok(document.revision > previous, "view revisions must increase");
      viewRevisions.set(document.viewId, document.revision);
      continue;
    }

    const event = message.params;
    if (event.type === "turn.started") activeTurns.add(event.turnId);
    if (event.type === "message.delta") {
      assert.ok(activeTurns.has(event.turnId), "stream deltas require an active turn");
      textByTurn.set(event.turnId, `${textByTurn.get(event.turnId) ?? ""}${event.payload.delta}`);
    }
    if (event.type === "message.completed") {
      assert.equal(textByTurn.get(event.turnId), event.payload.text);
    }
    if (event.type === "turn.completed") {
      assert.ok(activeTurns.delete(event.turnId), "a turn can reach a terminal state once");
      completedTurns.set(event.turnId, event.payload.status);
    }
  }

  assert.equal(pendingRequests.size, 0, "all fixture requests must receive a response");
  assert.equal(activeTurns.size, 0, "all fixture turns must be terminal");
  return { initializedPhases, completedTurns, textByTurn, viewRevisions, resumed };
}

test("all P4.7A schemas have unique IDs, compilable patterns, and resolvable local refs", async () => {
  const files = [
    "plugin-manifest.v1.schema.json",
    "agent-runtime-protocol.v1.schema.json",
    "plugin-view-protocol.v1.schema.json",
    "plugin-session-binding.v1.schema.json",
    "agent-event.v2.schema.json",
  ];
  const ids = new Set();

  async function inspect(value) {
    if (Array.isArray(value)) {
      for (const item of value) await inspect(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    if (typeof value.pattern === "string") assert.doesNotThrow(() => new RegExp(value.pattern));
    if (typeof value.$ref === "string" && !value.$ref.startsWith("#")) {
      const target = value.$ref.split("#", 1)[0];
      await assert.doesNotReject(readFile(path.join(contracts, target), "utf8"));
    }
    for (const child of Object.values(value)) await inspect(child);
  }

  for (const file of files) {
    const schema = await readJson("contracts", file);
    assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
    assert.ok(schema.$id);
    assert.equal(ids.has(schema.$id), false, `${schema.$id} must be unique`);
    ids.add(schema.$id);
    await inspect(schema);
  }
});

test("P4.7 keeps AgentEvent v1 frozen and introduces plugin-aware v2", async () => {
  const v1 = await readJson("contracts", "agent-event.v1.schema.json");
  const v2 = await readJson("contracts", "agent-event.v2.schema.json");

  assert.equal(v1.properties.schemaVersion.const, "1.0");
  assert.equal(v1.$defs.source.properties.agent.enum.length, 2);
  assert.equal(v1.$defs.eventType.enum.includes("user_input.requested"), false);
  assert.equal(v1.$defs.sessionState.enum.includes("waiting_user"), false);

  assert.equal(v2.properties.schemaVersion.const, "2.0");
  assert.ok(v2.required.includes("nativeSessionId"));
  assert.ok(v2.$defs.source.required.includes("pluginId"));
  assert.ok(v2.$defs.source.required.includes("pluginVersion"));
  assert.ok(v2.$defs.source.required.includes("agentId"));
  assert.ok(v2.$defs.eventType.enum.includes("user_input.requested"));
  assert.ok(v2.$defs.sessionState.enum.includes("waiting_user"));
  assert.ok(v2.$defs.sessionState.enum.includes("compacting"));
  assert.equal("agent" in v2.$defs.source.properties, false);
  assert.equal("transport" in v2.$defs.source.properties, false);
});

test("plugin manifest declares identity, compatibility, permissions, and safe package paths", async () => {
  const schema = await readJson("contracts", "plugin-manifest.v1.schema.json");
  const manifest = await readJson("fixtures", "plugins", "echo-agent", "plugin.json");
  const packagePath = new RegExp(schema.$defs.packagePath.pattern);

  assert.equal(manifest.schema, schema.properties.schema.const);
  assert.match(manifest.pluginId, new RegExp(schema.$defs.namespacedId.pattern));
  assert.match(manifest.version, new RegExp(schema.$defs.semver.pattern));
  assert.ok(packagePath.test(manifest.entrypoint.executable));
  assert.equal(packagePath.test("../escape"), false);
  assert.equal(packagePath.test("/absolute/plugin"), false);
  assert.equal(packagePath.test("C:\\absolute\\plugin.exe"), false);

  const agent = manifest.agents[0];
  assert.equal(agent.agentId, "dev.aibo.echo.agent");
  for (const required of [
    "session.create",
    "session.resume",
    "session.close",
    "turn.send",
    "turn.cancel",
    "stream.text",
    "view.standard",
  ]) {
    assert.ok(agent.capabilities.includes(required), `fixture requires ${required}`);
  }
  assert.equal(agent.requestedPermissions[0].required, false);
  assert.equal("enforcement" in agent.requestedPermissions[0], false);
});

test("runtime contract closes methods, permission results, and stable error kinds", async () => {
  const schema = await readJson("contracts", "agent-runtime-protocol.v1.schema.json");
  const definitions = schema.$defs;
  const requestMethods = [
    "initializeRequest",
    "diagnoseRequest",
    "sessionCreateRequest",
    "sessionResumeRequest",
    "sessionCloseRequest",
    "turnSendRequest",
    "turnCancelRequest",
    "operationInvokeRequest",
    "shutdownRequest",
  ].map((name) => definitions[name].properties.method.const);

  assert.deepEqual(requestMethods, [
    "aibo.initialize",
    "aibo.diagnose",
    "session.create",
    "session.resume",
    "session.close",
    "turn.send",
    "turn.cancel",
    "operation.invoke",
    "aibo.shutdown",
  ]);
  assert.deepEqual(definitions.permissionGrant.properties.decision.enum, ["granted", "denied", "unsupported"]);
  assert.deepEqual(definitions.permissionGrant.properties.enforcement.enum, ["core-proxy", "os-sandbox", "agent-native"]);
  assert.ok(definitions.errorResponse.properties.error.properties.data.properties.kind.enum.includes("protocol_incompatible"));
  assert.ok(definitions.errorResponse.properties.error.properties.data.properties.kind.enum.includes("invalid_recovery_data"));
  assert.match("ext.dev.aibo.echo.refresh", new RegExp(definitions.operationInvokeRequest.properties.params.properties.operationId.pattern));
  assert.equal(definitions.agentEventNotification.properties.params.properties.eventId, undefined);
  assert.equal(definitions.agentEventNotification.properties.params.properties.generationId, undefined);

  for (const target of ["plugin-session-binding.v1.schema.json", "plugin-view-protocol.v1.schema.json"]) {
    await assert.doesNotReject(readFile(path.join(contracts, target), "utf8"));
  }
});

test("Plugin View v1 exposes semantic properties without skin or executable escape hatches", async () => {
  const schema = await readJson("contracts", "plugin-view-protocol.v1.schema.json");
  const records = await readJsonl("fixtures", "plugins", "echo-agent.lifecycle.jsonl");
  const document = records.find((record) => record.message.method === "view/render").message.params.document;
  const nodes = collectNodes(document.root);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const actionIds = new Set(document.actions.map((action) => action.id));
  const allowedProps = schema.$defs.semanticProps.properties;

  assert.equal(schema.$defs.semanticProps.additionalProperties, false);
  for (const forbidden of ["class", "style", "color", "skin", "theme", "html", "script", "component"])
    assert.equal(forbidden in allowedProps, false, `${forbidden} must not be a view property`);
  assert.equal(nodeIds.size, nodes.length, "node IDs must be stable and unique within a document");
  for (const node of nodes) {
    assert.ok(schema.$defs.node.properties.type.enum.includes(node.type));
    for (const prop of Object.keys(node.props)) assert.ok(prop in allowedProps, `unknown semantic prop ${prop}`);
    if (node.props.actionId) assert.ok(actionIds.has(node.props.actionId), `undeclared action ${node.props.actionId}`);
  }
  for (const binding of document.bindings) {
    assert.ok(nodeIds.has(binding.nodeId), `binding target ${binding.nodeId} must exist`);
    assert.match(binding.dataPath, new RegExp(schema.$defs.binding.properties.dataPath.pattern));
  }
});

test("Plugin Session Binding v1 pins a release and versions recovery data", async () => {
  const schema = await readJson("contracts", "plugin-session-binding.v1.schema.json");
  const records = await readJsonl("fixtures", "plugins", "echo-agent.lifecycle.jsonl");
  const binding = records.find((record) => record.message.method === "session.resume").message.params.binding;

  assert.equal(binding.schema, schema.properties.schema.const);
  for (const field of ["pluginInstallationId", "pluginId", "pluginVersion", "agentId", "runtimeProtocolVersion"])
    assert.ok(schema.required.includes(field), `${field} must be durable`);
  assert.equal(binding.pluginId, "dev.aibo.echo");
  assert.equal(binding.pluginVersion, "1.0.0");
  assert.equal(binding.recovery.schema, "dev.aibo.echo.recovery");
  assert.equal(binding.recovery.version, 1);
});

test("Echo Agent fixture replays create, stream, cancel, restart, and resume", async () => {
  const records = await readJsonl("fixtures", "plugins", "echo-agent.lifecycle.jsonl");
  const replay = replayEchoLifecycle(records);

  assert.deepEqual([...replay.initializedPhases], ["generation-1", "generation-2"]);
  assert.equal(replay.textByTurn.get("turn-1"), "hello");
  assert.equal(replay.completedTurns.get("turn-1"), "completed");
  assert.equal(replay.completedTurns.get("turn-2"), "interrupted");
  assert.equal(replay.viewRevisions.get("dev.aibo.echo.tasks"), 1);
  assert.equal(replay.resumed, true);
});
