import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { JsonlProcess } from "./lib/jsonl-process.mjs";
import { assertProbe, countEvents, createProbeOutput } from "./lib/probe-output.mjs";

const repoCwd = path.resolve(process.cwd());
const workspaceCwd = await mkdtemp(path.join(process.env.TMPDIR ?? "/tmp", "aibo-pi-plugin-smoke-"));
const runtimeDataPath = path.join(workspaceCwd, "sessions");
const output = await createProbeOutput("pi-plugin-smoke", repoCwd);
const client = new JsonlProcess(process.execPath, ["src-tauri/builtin-plugins/pi/pi-plugin.mjs"], {
  cwd: repoCwd,
  env: { ...process.env },
}).start();
const messages = [];
client.on("message", (message) => {
  messages.push(message);
  void output.appendRaw("plugin", message);
});

let failure = null;
let sessionId = null;
let nativeSessionId = null;
let turnId = "pi-plugin-smoke-turn";
let completedText = null;

const request = async (method, params = {}, timeoutMs = 30_000) =>
  (await client.requestMessage({ jsonrpc: "2.0", method, params }, { timeoutMs })).result;

try {
  await mkdir(runtimeDataPath, { recursive: true });
  await request("aibo.initialize", {
    runtimeInstanceId: "smoke-" + Date.now(),
    generationId: "generation-" + Date.now(),
    host: {
      appVersion: "0.1.0",
      platform: process.platform + "-" + process.arch,
      runtimeProtocolVersions: ["1.0"],
      viewProtocolVersions: ["1.0"],
    },
    expectedPlugin: { pluginId: "dev.aibo.pi", pluginVersion: "1.0.0" },
    permissionGrants: [{
      id: "workspace.read",
      decision: "granted",
      enforcement: "agent-native",
      constraints: { roots: [workspaceCwd] },
    }],
  });
  sessionId = "pi-plugin-smoke-" + Date.now();
  const scope = {
    agentId: "dev.aibo.pi.agent",
    sessionId,
    workspace: { workspaceId: "probe", trusted: true, path: workspaceCwd },
    executionProfile: {
      schema: "aibo.execution-profile/v1",
      interactionMode: "ask",
      approvalPolicy: "never",
      filesystemPolicy: "read-only",
      commandPolicy: "disabled",
      networkPolicy: "disabled",
      runtimeDataPath,
    },
  };
  const session = await request("session.create", scope, 60_000);
  nativeSessionId = session.nativeSessionId;
  assertProbe(typeof nativeSessionId === "string" && nativeSessionId.length > 0, "Pi plugin did not create a native session");
  const completed = client.waitFor(
    (message) => message.method === "agent/event"
      && message.params?.sessionId === sessionId
      && message.params?.turnId === turnId
      && ["turn.completed", "turn.failed"].includes(message.params?.type),
    { timeoutMs: 60_000 },
  );
  await request("turn.send", {
    ...scope,
    turnId,
    input: {
      text: "Reply with exactly AIBO_PI_PLUGIN_SMOKE_OK. Do not use tools.",
      attachments: [],
    },
  }, 60_000);
  const terminal = await completed;
  assertProbe(terminal.params.type === "turn.completed", terminal.params.payload?.message ?? "Pi turn failed");
  completedText = messages
    .filter((message) => message.method === "agent/event"
      && message.params?.turnId === turnId
      && message.params?.type === "message.completed")
    .map((message) => message.params.payload?.text ?? "")
    .at(-1) ?? null;
  assertProbe(completedText === "AIBO_PI_PLUGIN_SMOKE_OK", "unexpected real provider response: " + (completedText ?? "<empty>"));
  const sessionFile = session.recovery?.data?.sessionFile;
  assertProbe(typeof sessionFile === "string" && sessionFile.length > 0, "Pi plugin did not expose a session file");
  await access(sessionFile);
  await request("session.close", { agentId: scope.agentId, sessionId }, 60_000);
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  await client.close({ graceMs: 2_000 });
  await output.flush();
  const summary = {
    agent: "pi-plugin-smoke",
    probeVersion: 1,
    provider: "real",
    platform: process.platform,
    package: "@earendil-works/pi-coding-agent@0.84.4",
    sessionId,
    nativeSessionId,
    turnId,
    completedText,
    eventCounts: countEvents(messages),
    failure,
  };
  await output.writeSummary(summary);
  if (failure) console.error(JSON.stringify(summary, null, 2));
  else console.log(JSON.stringify(summary, null, 2));
  if (!process.env.AIBO_KEEP_PROBE_DATA) {
    await rm(runtimeDataPath, { recursive: true, force: true }).catch(() => {});
    await rm(workspaceCwd, { recursive: true, force: true }).catch(() => {});
  }
}
