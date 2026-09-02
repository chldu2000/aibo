import { access, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  SessionManager,
  createBashTool,
  createPowerShellTool,
} from "@earendil-works/pi-coding-agent";
import { createProbeOutput } from "./lib/probe-output.mjs";

const cwd = path.resolve(process.cwd());
const sessionDir = path.join(cwd, ".aibo", "probe", "pi-sdk-sessions");
const output = await createProbeOutput("pi-sdk", cwd);
const shellName = process.platform === "win32" ? "powershell" : "bash";

let packageVersion = null;
let shellToolPassed = false;
let sessionPersisted = false;
let sessionReopened = false;
let sessionFile = null;
let sessionId = null;
let failure = null;

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

  const manager = SessionManager.create(cwd, sessionDir);
  sessionId = manager.getSessionId();
  manager.appendCustomEntry("aibo.phase0.probe", {
    schema: "aibo.pi-sdk-probe.v1",
    shellName,
    shellToolPassed,
  });
  manager.appendSessionInfo("aibo-phase0-sdk-probe");
  // Pi intentionally defers writing a new session until it contains an
  // assistant message. A synthetic, clearly labelled record lets this probe
  // validate the public persistence/reopen API without calling a model.
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

  if (!sessionFile) {
    throw new Error("Pi SDK did not persist the probe session");
  }
  await access(sessionFile);
  sessionPersisted = manager.isPersisted();

  const reopened = SessionManager.open(sessionFile, sessionDir, cwd);
  const customEntry = reopened
    .getEntries()
    .find((entry) => entry.type === "custom" && entry.customType === "aibo.phase0.probe");
  sessionReopened =
    reopened.getSessionId() === sessionId &&
    reopened.getSessionName() === "aibo-phase0-sdk-probe" &&
    customEntry?.data?.schema === "aibo.pi-sdk-probe.v1";

  if (!shellToolPassed || !sessionPersisted || !sessionReopened) {
    throw new Error("One or more Pi SDK probe assertions failed");
  }
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  const summary = {
    agent: "pi-sdk",
    probeVersion: 1,
    packageVersion,
    platform: process.platform,
    shellName,
    shellToolPassed,
    sessionPersisted,
    sessionReopened,
    sessionId,
    sessionFile,
    failure,
    runDir: output.runDir,
  };
  await output.writeSummary(summary);
  console.log(JSON.stringify(summary, null, 2));
}
