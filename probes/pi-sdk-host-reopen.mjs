import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import readline from "node:readline";
import { assertProbe, createProbeOutput } from "./lib/probe-output.mjs";

const cwd = path.resolve(process.cwd());
const sessionDir = path.join(cwd, ".aibo", "probe", "pi-sdk-host-reopen-sessions");
await mkdir(sessionDir, { recursive: true });
const output = await createProbeOutput("pi-sdk-host-reopen", cwd);

function countTreeNodes(nodes) {
  return nodes.reduce((count, node) => count + 1 + countTreeNodes(node.children ?? []), 0);
}

function spawnHost(label) {
  const child = spawn(process.execPath, [path.join(cwd, "src-tauri", "pi-sdk-host.mjs")], {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const events = [];
  const pending = new Map();
  let nextId = 1;
  let stderr = "";
  let exitResult;
  let resolveExit;
  const exited = new Promise((resolve) => { resolveExit = resolve; });
  child.once("exit", (code, signal) => {
    exitResult = { code, signal };
    for (const { reject } of pending.values()) reject(new Error(`${label} host exited before responding`));
    pending.clear();
    resolveExit(exitResult);
  });
  const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  lines.on("line", (line) => {
    let message;
    try { message = JSON.parse(line); } catch (error) {
      void output.appendRaw(`${label}-invalid`, { line, error: String(error) });
      return;
    }
    void output.appendRaw(label, message);
    if (message.method === "aibo/event") events.push(message.params.event);
    if (message.id !== undefined && pending.has(String(message.id))) {
      const waiter = pending.get(String(message.id));
      pending.delete(String(message.id));
      if (message.error) waiter.reject(new Error(message.error.message ?? JSON.stringify(message.error)));
      else waiter.resolve(message);
    }
  });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

  function request(method, params = {}) {
    const id = `${label}-${nextId++}`;
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
        else if (Date.now() - started >= timeoutMs) {
          clearInterval(timer);
          reject(new Error(`${label} timed out waiting for Pi host event`));
        }
      }, 25);
      timer.unref?.();
    });
  }

  async function dispose() {
    if (!exitResult) {
      try { await request("dispose"); } catch { /* process may already be gone */ }
      child.stdin.end();
      await exited;
    }
  }

  async function kill() {
    if (!exitResult) child.kill("SIGKILL");
    await exited;
  }

  return { request, waitFor, events, dispose, kill, get exitResult() { return exitResult; }, stderr };
}

let failure = null;
let firstStart = null;
let secondStart = null;
let firstTree = null;
let secondTree = null;
let crashObserved = false;
let reopened = false;
try {
  const first = spawnHost("first");
  firstStart = await first.request("start", { cwd, sessionDir });
  const sessionId = firstStart.result.sessionId;
  await first.request("prompt", { turnId: "reopen-turn-1", text: "Reply with exactly AIBO_PI_REOPEN_OK. No tools are needed." });
  const completed = await first.waitFor((event) => event.type === "turn_end");
  assertProbe(completed.message?.text === "AIBO_PI_REOPEN_OK", "reopen probe returned unexpected text");
  firstTree = await first.request("tree");
  assertProbe(firstTree.result?.leafId, "first host did not expose a leaf");
  assertProbe(countTreeNodes(firstTree.result.tree) >= 2, "first host tree was not persisted");
  await first.kill();
  crashObserved = first.exitResult?.signal === "SIGKILL";
  assertProbe(crashObserved, "first host did not observe the intentional crash");

  const second = spawnHost("second");
  secondStart = await second.request("start", { cwd, sessionDir, sessionId });
  reopened = secondStart.result.resumed === true && secondStart.result.sessionId === sessionId;
  assertProbe(reopened, "second host did not reopen the persisted Pi session");
  secondTree = await second.request("tree");
  assertProbe(secondTree.result?.leafId === firstTree.result.leafId, "reopened host changed the session leaf");
  assertProbe(countTreeNodes(secondTree.result.tree) >= 2, "reopened host lost the session tree");
  await second.dispose();
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
}

await output.appendRaw("host-stderr", { first: firstStart, second: secondStart });
await output.flush();
const summary = {
  agent: "pi-sdk-host-reopen",
  probeVersion: 1,
  platform: process.platform,
  crashObserved,
  reopened,
  firstSessionId: firstStart?.result?.sessionId ?? null,
  firstLeafId: firstTree?.result?.leafId ?? null,
  secondLeafId: secondTree?.result?.leafId ?? null,
  failure,
};
await output.writeSummary(summary);
console.log(JSON.stringify(summary, null, 2));
