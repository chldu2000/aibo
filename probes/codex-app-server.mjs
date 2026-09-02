import path from "node:path";
import process from "node:process";
import { JsonlProcess } from "./lib/jsonl-process.mjs";
import { countEvents, createProbeOutput } from "./lib/probe-output.mjs";

const approval = process.argv.includes("--approval");
const smoke = process.argv.includes("--smoke") || approval;
const codexBin = process.env.AIBO_CODEX_BIN ?? "codex";
const cwd = path.resolve(process.cwd());
const output = await createProbeOutput("codex", cwd);
const messages = [];
const warnings = [];
let approvalsObserved = 0;

function startClient() {
  const client = new JsonlProcess(codexBin, ["app-server", "--stdio"], { cwd }).start();
  client.on("message", (message) => {
    messages.push(message);
    void output.appendRaw("agent-to-aibo", message);
    if (
      message.id !== undefined &&
      [
        "item/commandExecution/requestApproval",
        "item/fileChange/requestApproval",
      ].includes(message.method)
    ) {
      approvalsObserved += 1;
      const response = { id: message.id, result: { decision: "decline" } };
      void output.appendRaw("aibo-to-agent", response);
      client.send(response);
    }
  });
  client.on("stderr", (text) => {
    const trimmed = text.trim();
    if (trimmed) warnings.push(trimmed);
  });
  client.on("protocolError", (error) => warnings.push(error.message));
  return client;
}

async function initialize(client) {
  const response = await client.rpcRequest("initialize", {
    clientInfo: {
      name: "aibo_phase0_probe",
      title: "Aibo Phase 0 Probe",
      version: "0.1.0",
    },
    capabilities: {
      experimentalApi: true,
    },
  });
  client.notify("initialized", {});
  return response.result;
}

let client;
let threadId;
let turnId;
let transportPassed = false;
let smokePassed = false;
let resumePassed = false;
let failure;

try {
  client = startClient();
  const initialized = await initialize(client);
  const listed = await client.rpcRequest("thread/list", {
    limit: 5,
    cwd,
    sortKey: "updated_at",
    sortDirection: "desc",
  });
  transportPassed = Array.isArray(listed.result?.data) && initialized !== undefined;

  if (smoke) {
    const started = await client.rpcRequest("thread/start", {
      cwd,
      approvalPolicy: approval ? "untrusted" : "never",
      sandbox: "read-only",
      serviceName: "aibo_phase0_probe",
    });
    threadId = started.result?.thread?.id;
    if (!threadId) throw new Error("Codex thread/start did not return a thread id");

    const completed = client.waitFor(
      (message) =>
        message.method === "turn/completed" &&
        message.params?.threadId === threadId,
      { timeoutMs: 180_000 },
    );
    const turn = await client.rpcRequest("turn/start", {
      threadId,
      input: [
        {
          type: "text",
          text: approval
            ? "Run the read-only command `Get-Location` exactly once, then reply with AIBO_CODEX_APPROVAL_PROBE_OK. Do not modify files."
            : "Reply with exactly AIBO_CODEX_PROBE_OK. Do not use tools or modify files.",
        },
      ],
    });
    turnId = turn.result?.turn?.id;
    const completedEvent = await completed;
    smokePassed = completedEvent.params?.turn?.status === "completed";

    const read = await client.rpcRequest("thread/read", {
      threadId,
      includeTurns: true,
    });
    if (!Array.isArray(read.result?.thread?.turns)) {
      throw new Error("Codex thread/read did not return turn history");
    }

    await client.close();
    client = startClient();
    await initialize(client);
    const resumed = await client.rpcRequest("thread/resume", { threadId });
    const reread = await client.rpcRequest("thread/read", {
      threadId,
      includeTurns: true,
    });
    resumePassed =
      resumed.result?.thread?.id === threadId &&
      reread.result?.thread?.turns?.some((item) => item.id === turnId);
  }
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  await client?.close();
  const summary = {
    agent: "codex",
    probeVersion: 1,
    cwd,
    smokeRequested: smoke,
    approvalRequested: approval,
    approvalsObserved,
    transportPassed,
    smokePassed: smoke ? smokePassed : null,
    resumePassed: smoke ? resumePassed : null,
    threadId: threadId ?? null,
    turnId: turnId ?? null,
    eventCounts: countEvents(messages),
    warnings: [...new Set(warnings)],
    failure: failure ?? null,
    runDir: output.runDir,
  };
  await output.writeSummary(summary);
  console.log(JSON.stringify(summary, null, 2));
}
