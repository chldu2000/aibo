import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

function safeTimestamp() {
  return new Date().toISOString().replaceAll(":", "-");
}

export async function createProbeOutput(agent, cwd = process.cwd()) {
  const baseDir = process.env.AIBO_PROBE_OUTPUT
    ? path.resolve(process.env.AIBO_PROBE_OUTPUT)
    : path.join(cwd, ".aibo", "probe", "runs");
  const runDir = path.join(baseDir, `${agent}-${safeTimestamp()}`);
  await mkdir(runDir, { recursive: true });

  return {
    runDir,
    async appendRaw(direction, payload) {
      const record = {
        at: new Date().toISOString(),
        direction,
        payload,
      };
      await appendFile(path.join(runDir, "events.jsonl"), `${JSON.stringify(record)}\n`);
    },
    async writeSummary(summary) {
      await writeFile(
        path.join(runDir, "summary.json"),
        `${JSON.stringify(summary, null, 2)}\n`,
      );
    },
  };
}

export function eventName(message) {
  if (message.method) return message.method;
  if (message.type) return message.type;
  if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
    return "response";
  }
  return "unknown";
}

export function countEvents(messages) {
  const counts = {};
  for (const message of messages) {
    const name = eventName(message);
    counts[name] = (counts[name] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}
