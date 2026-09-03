import path from "node:path";
import process from "node:process";
import { JsonlProcess } from "./lib/jsonl-process.mjs";
import { assertProbe, countEvents, createProbeOutput } from "./lib/probe-output.mjs";

const approval = process.argv.includes("--approval");
const lifecycle = process.argv.includes("--lifecycle");
const smoke = process.argv.includes("--smoke") || approval || lifecycle;
const codexBin = process.env.AIBO_CODEX_BIN ?? "codex";
const cwd = path.resolve(process.cwd());
const approvalCommand = process.platform === "win32" ? "Get-Location" : "pwd";
const output = await createProbeOutput("codex", cwd);
const messages = [];
const warnings = [];
let approvalsObserved = 0;
let approvalsResolved = 0;
let forkedThreadId;
let forkPassed = false;
let archivePassed = false;

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
    if (message.method === "serverRequest/resolved") approvalsResolved += 1;
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
let lifecycleClient;
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
  assertProbe(transportPassed, "initialize and thread/list must return valid responses");

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
            ? `Run the read-only command \`${approvalCommand}\` exactly once, then reply with AIBO_CODEX_APPROVAL_PROBE_OK. Do not modify files.`
            : "Reply with exactly AIBO_CODEX_PROBE_OK. Do not use tools or modify files.",
        },
      ],
    });
    turnId = turn.result?.turn?.id;
    assertProbe(turnId, "turn/start did not return a turn id");
    const completedEvent = await completed;
    smokePassed = completedEvent.params?.turn?.status === "completed";
    assertProbe(smokePassed, "turn did not complete successfully");
    if (approval) {
      assertProbe(approvalsObserved > 0, "approval probe did not observe an approval request");
      assertProbe(approvalsResolved > 0, "approval probe did not observe serverRequest/resolved");
    }

    const read = await client.rpcRequest("thread/read", {
      threadId,
      includeTurns: true,
    });
    if (!Array.isArray(read.result?.thread?.turns)) {
      throw new Error("Codex thread/read did not return turn history");
    }

    if (lifecycle) {
      lifecycleClient = startClient();
      await initialize(lifecycleClient);
      const forked = await lifecycleClient.rpcRequest("thread/fork", {
        threadId,
        lastTurnId: turnId,
      });
      forkedThreadId = forked.result?.thread?.id;
      forkPassed =
        typeof forkedThreadId === "string" &&
        forkedThreadId !== threadId &&
        forked.result?.thread?.forkedFromId === threadId;
      assertProbe(forkPassed, "thread/fork did not return a distinct child thread");

      const archivedEvent = lifecycleClient.waitFor(
        (message) =>
          message.method === "thread/archived" &&
          message.params?.threadId === forkedThreadId,
        { timeoutMs: 20_000 },
      );
      const archived = await lifecycleClient.rpcRequest("thread/archive", {
        threadId: forkedThreadId,
      });
      await archivedEvent;
      const listedAfterArchive = await lifecycleClient.rpcRequest("thread/list", {
        limit: 100,
        cwd,
        sortKey: "updated_at",
        sortDirection: "desc",
      });
      archivePassed =
        archived.result !== undefined &&
        !listedAfterArchive.result?.data?.some((item) => item.id === forkedThreadId);
      assertProbe(archivePassed, "thread/archive did not remove the child from active listings");
      await lifecycleClient.close();
      lifecycleClient = undefined;
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
    assertProbe(resumePassed, "thread/resume did not restore the completed turn");
  }
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  await client?.close();
  await lifecycleClient?.close();
  await output.flush();
  const summary = {
    agent: "codex",
    probeVersion: 1,
    cwd,
    smokeRequested: smoke,
    approvalRequested: approval,
    lifecycleRequested: lifecycle,
    approvalsObserved,
    approvalsResolved,
    transportPassed,
    smokePassed: smoke ? smokePassed : null,
    resumePassed: smoke ? resumePassed : null,
    forkPassed: lifecycle ? forkPassed : null,
    archivePassed: lifecycle ? archivePassed : null,
    threadId: threadId ?? null,
    turnId: turnId ?? null,
    forkedThreadId: forkedThreadId ?? null,
    eventCounts: countEvents(messages),
    warnings: [...new Set(warnings)],
    failure: failure ?? null,
    runDir: output.runDir,
  };
  await output.writeSummary(summary);
  console.log(JSON.stringify(summary, null, 2));
}
