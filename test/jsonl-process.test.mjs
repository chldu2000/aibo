import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { JsonlProcess } from "../probes/lib/jsonl-process.mjs";

test("strictly frames LF-delimited JSON and preserves Unicode separators", async () => {
  const script = [
    "let buffer = '';",
    "process.stdin.setEncoding('utf8');",
    "process.stdin.on('data', chunk => {",
    "  buffer += chunk;",
    "  const index = buffer.indexOf('\\n');",
    "  if (index === -1) return;",
    "  const request = JSON.parse(buffer.slice(0, index));",
    "  process.stdout.write(JSON.stringify({ id: request.id, result: { text: 'a\\u2028b\\u2029c' } }) + '\\n');",
    "});",
  ].join("\n");

  const client = new JsonlProcess(process.execPath, ["-e", script], {
    cwd: process.cwd(),
  }).start();

  const response = await client.rpcRequest("echo", {});
  assert.equal(response.result.text, "a\u2028b\u2029c");
  await client.close();
});

test("emits protocol errors for invalid JSON without resolving a request", async () => {
  const script = "process.stdout.write('not-json\\n'); setTimeout(() => process.exit(0), 10);";
  const client = new JsonlProcess(process.execPath, ["-e", script], {
    cwd: process.cwd(),
  }).start();

  const [error] = await once(client, "protocolError");
  assert.match(error.message, /Invalid JSONL/);
  await client.close();
});

test("does not resolve a request from a streaming event with the same id", async () => {
  const script = [
    "let buffer = '';",
    "process.stdin.setEncoding('utf8');",
    "process.stdin.on('data', chunk => {",
    "  buffer += chunk;",
    "  const index = buffer.indexOf('\\n');",
    "  if (index === -1) return;",
    "  const request = JSON.parse(buffer.slice(0, index));",
    "  process.stdout.write(JSON.stringify({ id: request.id, type: 'progress', delta: 'x' }) + '\\n');",
    "  process.stdout.write(JSON.stringify({ id: request.id, type: 'response', command: 'work', success: true, data: { done: true } }) + '\\n');",
    "});",
  ].join("\n");

  const client = new JsonlProcess(process.execPath, ["-e", script], {
    cwd: process.cwd(),
  }).start();

  const response = await client.requestMessage({ type: "work" });
  assert.equal(response.type, "response");
  assert.equal(response.data.done, true);
  await client.close();
});
