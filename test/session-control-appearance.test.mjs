import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sessionControlAppearance } from '../src/lib/ui-kit/session-control-appearance.ts';

for (const agent of ['codex', 'pi']) {
  test(`${agent} session controls have distinct visual identities derived from policy`, () => {
    const controls = JSON.parse(readFileSync(new URL(`../src-tauri/capability-plugins/${agent}/plugin.json`, import.meta.url))).contributions[0].sessionControls;
    const appearances = controls.map(sessionControlAppearance);
    assert.equal(new Set(appearances.map(value => value.icon)).size, controls.length);
    assert.equal(new Set(appearances.map(value => value.tone)).size, controls.length);
    assert.deepEqual(controls.map(control => sessionControlAppearance({ ...control, id: 'other-plugin-option', label: 'Custom label' })), appearances);
  });
}

test('unknown controls stay neutral and full access remains explicit even in plan mode', () => {
  assert.deepEqual(sessionControlAppearance({ kind: 'permission', profile: { filesystemPolicy: 'agent-managed' } }), { icon: 'settings', tone: 'neutral' });
  assert.deepEqual(sessionControlAppearance({ kind: 'mode', profile: { interactionMode: 'plan', filesystemPolicy: 'danger-full-access' } }), { icon: 'shield-alert', tone: 'elevated' });
  assert.equal(sessionControlAppearance({ kind: 'mode', profile: { interactionMode: 'edit', commandPolicy: 'approved' } }).icon, 'edit');
});
