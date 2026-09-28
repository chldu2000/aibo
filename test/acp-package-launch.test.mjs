import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import '../packages/plugin-host/register.mjs';
const { acpAgentConfig, extensionFromConfig } = await import('@aibo/acp-adapter/worker');
import { sessionCapability } from './helpers/session-capability.mjs';

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'aibo package #%-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await cp('fixtures/plugins/acp-echo', directory, { recursive: true });
  await mkdir(path.join(directory, 'vendor'));
  await cp('fixtures/acp/echo-agent.mjs', path.join(directory, 'vendor/agent.mjs'));
  const config = JSON.parse(await readFile(path.join(directory, 'acp.json')));
  delete config.command;
  config.launch = { kind: 'node', entry: 'vendor/agent.mjs' };
  await writeFile(path.join(directory, 'acp.json'), JSON.stringify(config));
  const manifest = JSON.parse(await readFile(path.join(directory, 'plugin.json')));
  manifest.executableDependencies = manifest.executableDependencies.filter(entry => entry.kind === 'runtime');
  await writeFile(path.join(directory, 'plugin.json'), JSON.stringify(manifest));
  return { directory, config, manifest, manifestUrl: pathToFileURL(path.join(directory, 'plugin.json')) };
}

test('package ACP opens, streams and resumes with no PATH and a different workspace cwd', async t => {
  const { directory } = await fixture(t);
  const f = await sessionCapability(t, directory, { PATH: '', ECHO_LOAD: '1' });
  const profile = { schema: 'aibo.execution-profile/v1', interactionMode: 'ask', filesystemPolicy: 'read-only', commandPolicy: 'disabled', networkPolicy: 'agent-managed', approvalPolicy: 'never', approvalReviewer: 'none', model: null, reasoningEffort: null };
  const opened = await f.invoke('aibo.session.open', { mode: 'create', executionProfile: profile });
  assert.equal((await f.startTurn('private runtime').done).status, 'completed');
  assert.ok(f.events.some(entry => entry.event.type === 'message.completed' && entry.event.payload.text === 'echo: private runtime'));
  const restarted = await f.restart();
  const resumed = await restarted.invoke('aibo.session.open', { mode: 'resume', executionProfile: profile, recovery: opened.recovery });
  assert.equal(resumed.nativeSessionId, opened.nativeSessionId);
});

test('package launch rejects traversal, ambiguous command, missing files and escaping symlinks', async t => {
  const { directory, config, manifest, manifestUrl } = await fixture(t);
  for (const entry of ['../outside.js', '/tmp/outside.js', 'C:\\outside.js', 'vendor/../agent.js', 'vendor//agent.js', 'vendor/agent.js\0', 'vendor/agent.exe']) {
    assert.throws(() => acpAgentConfig({ ...config, launch: { kind: 'node', entry } }, manifest), /package-relative/);
  }
  assert.throws(() => acpAgentConfig({ ...config, command: 'sh' }, manifest), /without command/);
  const parsed = acpAgentConfig(config, manifest);
  assert.equal(extensionFromConfig(parsed, manifest, manifestUrl).command, process.execPath);
  await rm(path.join(directory, 'vendor/agent.mjs'));
  assert.throws(() => extensionFromConfig(parsed, manifest, manifestUrl), /ENOENT/);
  await symlink(path.resolve('fixtures/acp/echo-agent.mjs'), path.join(directory, 'vendor/agent.mjs'));
  assert.throws(() => extensionFromConfig(parsed, manifest, manifestUrl), /escapes/);
});
