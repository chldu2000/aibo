import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import readline from "node:readline";
import { createProbeOutput, assertProbe } from "./lib/probe-output.mjs";

const smoke = process.argv.includes("--smoke");
const cwd = path.resolve(process.cwd());
const sessionDir = path.join(cwd, ".aibo", "probe", "pi-sdk-host-sessions");
await mkdir(sessionDir, { recursive: true });
const output = await createProbeOutput("pi-sdk-host", cwd);
const child = spawn(process.execPath, [path.join(cwd, "src-tauri", "pi-sdk-host.mjs")], {
  cwd,
  stdio: ["pipe", "pipe", "pipe"],
});
const events = [];
const pending = new Map();
let nextId = 1;
let stderr = "";

const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
lines.on("line", (line) => {
  void output.appendRaw("host", JSON.parse(line));
  const message = JSON.parse(line);
  if (message.method === "aibo/event") events.push(message.params.event);
  if (message.id !== undefined && pending.has(String(message.id))) {
    const { resolve, reject } = pending.get(String(message.id));
    pending.delete(String(message.id));
    if (message.error) reject(new Error(message.error.message ?? JSON.stringify(message.error)));
    else resolve(message);
  }
});
child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

function request(method, params = {}) {
  const id = `probe-${nextId++}`;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  });
}

function waitFor(predicate, timeoutMs = 180_000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const match = events.find(predicate);
      if (match) { clearInterval(timer); resolve(match); }
      else {
        const failureEvent = events.find((event) => event.type === "agent_error");
        if (failureEvent) { clearInterval(timer); reject(new Error(failureEvent.error ?? "Pi SDK agent error")); }
        else if (Date.now() - started >= timeoutMs) { clearInterval(timer); reject(new Error(`Timed out waiting for Pi host event after ${timeoutMs} ms`)); }
      }
    }, 25);
    timer.unref?.();
  });
}

function countTreeNodes(nodes) {
  return nodes.reduce((count, node) => count + 1 + countTreeNodes(node.children ?? []), 0);
}

let failure = null;
let startResponse = null;
try {
  startResponse = await request("start", { cwd, sessionDir });
  assertProbe(startResponse.result.protocol === "aibo-pi-sdk-host.v1", "Pi SDK host protocol mismatch");
  assertProbe(Array.isArray(startResponse.result.capabilities) && startResponse.result.capabilities.includes("read-only-tools"), "Pi SDK host did not advertise read-only tools");
  const initialTree = await request("tree");
  assertProbe(Array.isArray(initialTree.result?.tree), "Pi SDK host did not return a session tree");
  if (smoke) {
    await request("prompt", { turnId: "probe-turn-1", text: "Reply with exactly AIBO_PI_SDK_HOST_OK. No tools are needed." });
    const completed = await waitFor((event) => event.type === "turn_end");
    const text = completed.message?.text ?? "";
    assertProbe(text === "AIBO_PI_SDK_HOST_OK", `Pi SDK host returned unexpected text: ${text}`);
    const tree = await request("tree");
    assertProbe(tree.result?.leafId, "Pi SDK host did not expose the current tree leaf after a turn");
    assertProbe(Array.isArray(tree.result?.tree) && countTreeNodes(tree.result.tree) >= 2, "Pi SDK host tree did not retain the completed turn");
    events.length = 0;
    await request("prompt", { turnId: "probe-turn-2", text: "Generate a long numbered response and keep going until aborted." });
    await waitFor((event) => event.type === "message_start" && event.message?.role === "assistant");
    const steered = await request("steer", { text: "Stop the current response and summarize in one sentence." });
    assertProbe(steered.result?.accepted === true && steered.result?.mode === "steer", "Pi SDK host did not accept steer");
    await request("abort");
    const aborted = await waitFor((event) => event.type === "turn_end");
    assertProbe(aborted.message?.stopReason === "aborted", "Pi SDK host abort did not produce an aborted turn");
    events.length = 0;
    await request("prompt", { turnId: "probe-turn-3", text: "Generate a long numbered response and keep going until aborted." });
    await waitFor((event) => event.type === "message_start" && event.message?.role === "assistant");
    const followed = await request("followUp", { text: "After this response, add a one-line summary." });
    assertProbe(followed.result?.accepted === true && followed.result?.mode === "followUp", "Pi SDK host did not accept follow-up");
    await request("abort");
    const followUpAborted = await waitFor((event) => event.type === "turn_end");
    assertProbe(followUpAborted.message?.stopReason === "aborted", "Pi SDK host follow-up abort did not produce an aborted turn");
  }
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  try { await request("dispose"); } catch { /* host may already have exited */ }
  child.stdin.end();
  await new Promise((resolve) => child.once("exit", resolve));
  await output.appendRaw("host-stderr", stderr);
  await output.flush();
  const summary = {
    agent: "pi-sdk-host",
    probeVersion: 1,
    platform: process.platform,
    smokeRequested: smoke,
    protocol: startResponse?.result?.protocol ?? null,
    sessionId: startResponse?.result?.sessionId ?? null,
    eventTypes: [...new Set(events.map((event) => event.type))],
    failure,
  };
  await output.writeSummary(summary);
  if (failure) console.error(JSON.stringify(summary, null, 2));
  else console.log(JSON.stringify(summary, null, 2));
}
