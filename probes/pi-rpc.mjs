import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { JsonlProcess } from "./lib/jsonl-process.mjs";
import { countEvents, createProbeOutput } from "./lib/probe-output.mjs";

const smoke = process.argv.includes("--smoke");
const cwd = path.resolve(process.cwd());
const sessionDir = path.join(cwd, ".aibo", "probe", "pi-sessions");
const output = await createProbeOutput("pi", cwd);
const messages = [];
const warnings = [];

function resolvePiInvocation() {
  const override = process.env.AIBO_PI_BIN;
  if (process.platform !== "win32") {
    return { command: override ?? "pi", prefixArgs: [] };
  }

  if (override?.toLowerCase().endsWith(".exe")) {
    return { command: override, prefixArgs: [] };
  }
  if (override?.toLowerCase().endsWith(".js")) {
    return { command: process.execPath, prefixArgs: [override] };
  }

  const shim = override ?? execFileSync("where.exe", ["pi.cmd"], { encoding: "utf8" })
    .split(/\r?\n/u)
    .find(Boolean);
  if (!shim) throw new Error("Could not resolve the Pi CLI on PATH");

  const cli = path.join(
    path.dirname(shim),
    "node_modules",
    "@earendil-works",
    "pi-coding-agent",
    "dist",
    "cli.js",
  );
  if (!existsSync(cli)) {
    throw new Error(
      `Pi's Windows command shim was found, but its Node entry point was not: ${cli}`,
    );
  }

  return { command: process.execPath, prefixArgs: [cli] };
}

const piInvocation = resolvePiInvocation();

function startClient(sessionFile) {
  const args = [
    "--mode",
    "rpc",
    "--session-dir",
    sessionDir,
    "--name",
    "aibo-phase0-probe",
    "--no-tools",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-context-files",
    "--no-approve",
  ];
  if (sessionFile) args.push("--session", sessionFile);

  const client = new JsonlProcess(
    piInvocation.command,
    [...piInvocation.prefixArgs, ...args],
    { cwd },
  ).start();
  client.on("message", (message) => {
    messages.push(message);
    void output.appendRaw("agent-to-aibo", message);
  });
  client.on("stderr", (text) => {
    const trimmed = text.trim();
    if (trimmed) warnings.push(trimmed);
  });
  client.on("protocolError", (error) => warnings.push(error.message));
  return client;
}

let client;
let sessionFile;
let sessionId;
let transportPassed = false;
let directCommandPassed = false;
let sessionNamePassed = false;
let smokePassed = false;
let resumePassed = false;
let historyResumePassed = false;
let failure;

try {
  client = startClient();
  const state = await client.requestMessage({ type: "get_state" });
  sessionFile = state.data?.sessionFile;
  sessionId = state.data?.sessionId;
  transportPassed = state.command === "get_state" && Boolean(sessionId);

  const named = await client.requestMessage({
    type: "set_session_name",
    name: "aibo-phase0-probe-persisted",
  });
  sessionNamePassed = named.success === true;
  transportPassed = transportPassed && sessionNamePassed;

  const directCommand = await client.requestMessage(
    { type: "bash", command: "node --version" },
    { timeoutMs: 30_000 },
  );
  directCommandPassed = directCommand.data?.exitCode === 0;

  if (!sessionFile) throw new Error("Pi did not expose a persistent session file");
  await client.close();
  client = startClient(sessionFile);
  const initialResume = await client.requestMessage({ type: "get_state" });
  resumePassed =
    initialResume.data?.sessionFile === sessionFile &&
    initialResume.data?.sessionId === sessionId;

  if (smoke) {
    const settled = client.waitFor(
      (message) => message.type === "agent_settled",
      { timeoutMs: 180_000 },
    );
    await client.requestMessage({
      type: "prompt",
      message: "Reply with exactly AIBO_PI_PROBE_OK. No tools are available.",
    });
    await settled;
    const lastText = await client.requestMessage({ type: "get_last_assistant_text" });
    smokePassed = lastText.data?.text?.trim() === "AIBO_PI_PROBE_OK";

    const after = await client.requestMessage({ type: "get_state" });
    sessionFile = after.data?.sessionFile ?? sessionFile;
    await client.close();
    client = startClient(sessionFile);
    const resumed = await client.requestMessage({ type: "get_state" });
    historyResumePassed =
      resumed.data?.sessionFile === sessionFile && resumed.data?.messageCount >= 2;
  }
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  await client?.close();
  const summary = {
    agent: "pi",
    probeVersion: 1,
    cwd,
    smokeRequested: smoke,
    transportPassed,
    directCommandPassed,
    sessionNamePassed,
    smokePassed: smoke ? smokePassed : null,
    resumePassed,
    historyResumePassed: smoke ? historyResumePassed : null,
    sessionId: sessionId ?? null,
    sessionFile: sessionFile ?? null,
    eventCounts: countEvents(messages),
    warnings: [...new Set(warnings)],
    failure: failure ?? null,
    runDir: output.runDir,
  };
  await output.writeSummary(summary);
  console.log(JSON.stringify(summary, null, 2));
}
