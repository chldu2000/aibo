import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(process.cwd());

test("AgentEvent v1 schema is valid JSON with a frozen version", async () => {
  const schema = JSON.parse(
    await readFile(path.join(root, "contracts", "agent-event.v1.schema.json"), "utf8"),
  );
  assert.equal(schema.properties.schemaVersion.const, "1.0");
  assert.ok(schema.$defs.eventType.enum.includes("approval.requested"));
  assert.ok(schema.$defs.sessionState.enum.includes("interrupted"));
});

for (const fixture of [
  ["codex", "events.redacted.jsonl"],
  ["pi", "events.redacted.jsonl"],
  ["pi", "session.redacted.jsonl"],
]) {
  test(`fixture ${fixture.join("/")} contains valid LF-delimited JSON`, async () => {
    const contents = await readFile(path.join(root, "fixtures", ...fixture), "utf8");
    assert.equal(contents.includes("\r"), false);
    const lines = contents.trimEnd().split("\n");
    assert.ok(lines.length > 0);
    for (const line of lines) assert.doesNotThrow(() => JSON.parse(line));
  });
}
