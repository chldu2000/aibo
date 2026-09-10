import assert from 'node:assert/strict';
import test from 'node:test';
import { sessionModelBackend } from '../src/lib/app/agent-kind.ts';

const session = (agent, pluginInstallationId, capabilities = []) => ({
  agent, pluginInstallationId, capabilities,
});

test('built-in Pi plugin uses the model API that persists execution settings', () => {
  assert.equal(sessionModelBackend(session('dev.aibo.pi.agent', 'pi-installation', [
    'model.select', 'model.reasoning', 'session.tree',
  ])), 'pi');
  assert.equal(sessionModelBackend(session('external.agent', 'external-installation', [
    'model.select',
  ])), 'plugin');
  assert.equal(sessionModelBackend(session('codex', null, [])), 'profile');
});
