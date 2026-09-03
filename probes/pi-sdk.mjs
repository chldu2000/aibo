import { access, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
  createBashTool,
  createPowerShellTool,
} from "@earendil-works/pi-coding-agent";
import { assertProbe, createProbeOutput } from "./lib/probe-output.mjs";

const smoke = process.argv.includes("--smoke");
const cwd = path.resolve(process.cwd());
const sessionDir = path.join(cwd, ".aibo", "probe", "pi-sdk-sessions");
const output = await createProbeOutput("pi-sdk", cwd);
const shellName = process.platform === "win32" ? "powershell" : "bash";

let packageVersion = null;
let shellToolPassed = false;
let sessionPersisted = false;
let sessionReopened = false;
let smokePassed = false;
let abortPassed = false;
let historyResumePassed = false;
let sessionTreePassed = false;
let sessionFile = null;
let sessionId = null;
let eventCounts = {};
let modelFallbackMessage = null;
let failure = null;

function textFromMessage(message) {
  return message?.content
    ?.filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("")
    .trim();
}

function countSessionEvents(events) {
  const counts = {};
  for (const event of events) counts[event.type] = (counts[event.type] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function waitForSessionEvent(session, predicate, timeoutMs = 180_000) {
  return new Promise((resolve, reject) => {
    let timer;
    const unsubscribe = session.subscribe((event) => {
      try {
        if (!predicate(event)) return;
        clearTimeout(timer);
        unsubscribe();
        resolve(event);
      } catch (error) {
        clearTimeout(timer);
        unsubscribe();
        reject(error);
      }
    });
    timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out after ${timeoutMs} ms waiting for Pi SDK event`));
    }, timeoutMs);
    timer.unref?.();
  });
}

async function runStorageProbe() {
  const manager = SessionManager.create(cwd, sessionDir);
  const probeSessionId = manager.getSessionId();
  sessionId = probeSessionId;
  manager.appendCustomEntry("aibo.phase0.probe", {
    schema: "aibo.pi-sdk-probe.v1",
    shellName,
    shellToolPassed,
  });
  manager.appendSessionInfo("aibo-phase0-sdk-probe");
  // Pi intentionally defers writing a new session until it contains an
  // assistant message. A synthetic, clearly labelled record validates only
  // the public persistence/reopen API; it is not a model turn.
  manager.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "AIBO_PI_SDK_PERSISTENCE_PROBE" }],
    api: "aibo-probe",
    provider: "aibo-probe",
    model: "no-model",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  });
  sessionFile = manager.getSessionFile() ?? null;
  assertProbe(sessionFile, "Pi SDK did not persist the storage probe session");
  await access(sessionFile);
  sessionPersisted = manager.isPersisted();

  const reopened = SessionManager.open(sessionFile, sessionDir, cwd);
  const customEntry = reopened
    .getEntries()
    .find((entry) => entry.type === "custom" && entry.customType === "aibo.phase0.probe");
  sessionReopened =
    reopened.getSessionId() === probeSessionId &&
    reopened.getSessionName() === "aibo-phase0-sdk-probe" &&
    customEntry?.data?.schema === "aibo.pi-sdk-probe.v1";
  assertProbe(sessionPersisted, "Pi SDK storage probe did not report persistence");
  assertProbe(sessionReopened, "Pi SDK storage probe did not reopen consistently");
}

async function runModelProbe() {
  const manager = SessionManager.create(cwd, sessionDir);
  const modelRuntime = await ModelRuntime.create();
  const { session, modelFallbackMessage: fallback } = await createAgentSession({
    cwd,
    sessionManager: manager,
    modelRuntime,
    noTools: "all",
    tools: [],
  });
  modelFallbackMessage = fallback ?? null;
  const events = [];
  const unsubscribe = session.subscribe((event) => {
    events.push(event);
    void output.appendRaw("pi-sdk-event", event);
  });

  try {
    sessionId = session.sessionId;
    await session.prompt("Reply with exactly AIBO_PI_SDK_PROBE_OK. No tools are available.");
    const lastText = textFromMessage(
      [...session.messages].reverse().find((message) => message.role === "assistant"),
    );
    smokePassed = lastText === "AIBO_PI_SDK_PROBE_OK";
    assertProbe(smokePassed, "Pi SDK did not return the expected smoke response");

    sessionFile = session.sessionFile ?? null;
    assertProbe(sessionFile, "Pi SDK did not expose a persisted model session file");
    await access(sessionFile);
    sessionPersisted = true;

    const abortStart = events.length;
    const firstDelta = waitForSessionEvent(
      session,
      (event) =>
        event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta",
    );
    const pendingAbortPrompt = session.prompt(
      "Generate a long response with many numbered observations, then stop.",
    );
    await firstDelta;
    await session.abort();
    await pendingAbortPrompt;
    abortPassed = events
      .slice(abortStart)
      .some(
        (event) =>
          event.type === "agent_end" &&
          event.messages?.some((message) => message.stopReason === "aborted"),
      );
    assertProbe(abortPassed, "Pi SDK abort did not produce an aborted agent run");
  } finally {
    unsubscribe();
    session.dispose();
  }

  const reopened = await createAgentSession({
    cwd,
    sessionManager: SessionManager.open(sessionFile, sessionDir, cwd),
    modelRuntime,
    noTools: "all",
    tools: [],
  });
  try {
    const listed = await SessionManager.list(cwd, sessionDir);
    const listedSession = listed.find((item) => item.id === sessionId);
    const entries = reopened.session.sessionManager.getEntries();
    const tree = reopened.session.sessionManager.getTree();
    sessionTreePassed = Boolean(listedSession) && entries.length >= 2 && tree.length > 0;
    assertProbe(sessionTreePassed, "Pi SDK session list/tree did not restore the model session");
    historyResumePassed =
      reopened.session.sessionId === sessionId && reopened.session.messages.length >= 2;
    assertProbe(historyResumePassed, "Pi SDK reopen did not restore the model history");
    sessionReopened = historyResumePassed;
  } finally {
    reopened.session.dispose();
  }
  eventCounts = countSessionEvents(events);
}

try {
  const packageJson = JSON.parse(
    await readFile(
      path.join(cwd, "node_modules", "@earendil-works", "pi-coding-agent", "package.json"),
      "utf8",
    ),
  );
  packageVersion = packageJson.version;

  const shellTool = process.platform === "win32"
    ? createPowerShellTool(cwd)
    : createBashTool(cwd);
  const updates = [];
  const shellResult = await shellTool.execute(
    "aibo-pi-sdk-probe",
    { command: "node --version", timeout: 30 },
    undefined,
    (update) => updates.push(update),
  );
  await output.appendRaw("pi-sdk-tool-updates", updates);
  await output.appendRaw("pi-sdk-tool-result", shellResult);
  const resultText = shellResult.content
    ?.filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("")
    .trim();
  shellToolPassed = /^v\d+\.\d+\.\d+/u.test(resultText ?? "");
  assertProbe(shellToolPassed, "Pi SDK shell tool did not return a Node version");

  if (smoke) await runModelProbe();
  else await runStorageProbe();
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  await output.flush();
  const summary = {
    agent: "pi-sdk",
    probeVersion: 2,
    platform: process.platform,
    packageVersion,
    shellName,
    smokeRequested: smoke,
    shellToolPassed,
    smokePassed: smoke ? smokePassed : null,
    abortPassed: smoke ? abortPassed : null,
    sessionPersisted,
    sessionReopened,
    historyResumePassed: smoke ? historyResumePassed : null,
    sessionTreePassed: smoke ? sessionTreePassed : null,
    modelFallbackMessage,
    sessionId,
    sessionFile,
    eventCounts,
    failure,
    runDir: output.runDir,
  };
  await output.writeSummary(summary);
  console.log(JSON.stringify(summary, null, 2));
}
