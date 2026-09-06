import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { compileModule } from 'svelte/compiler';

test('draft persistence settles after restore, edits, and failure-state changes', async () => {
  const app = await readFile(new URL('../src/App.svelte', import.meta.url), 'utf8');
  const start = app.indexOf('  $effect(() => {\n    const id = selectedSessionId;\n    const text = composerText;');
  assert.ok(start >= 0);
  const effect = app.slice(start, app.indexOf('\n  });', start) + 6);
  const source = `
    import { effect_root, flush, untrack } from 'test-runtime';
    export function run() {
      let selectedSessionId = $state('session');
      let desktop = $state(true);
      let composerText = $state('restored draft');
      let composerDrafts = $state({});
      let draftHydratingSessionId = $state('session');
      const composerDraftFailed = $derived(
        selectedSessionId ? composerDrafts[selectedSessionId]?.sendFailed === true : false
      );
      let writes = [];
      function writePersistedComposerDrafts() {
        if (writes.length > 10) throw new Error('draft effect keeps rescheduling itself');
      }
      function scheduleComposerDraftWrite(id, text, failed) { writes.push({ id, text, failed }); }
      const dispose = effect_root(() => { ${effect} });
      flush();
      return {
        writes, dispose,
        hydrate() { draftHydratingSessionId = null; flush(); },
        edit(text) { composerText = text; flush(); },
        fail() { composerDrafts = { ...composerDrafts, session: { ...composerDrafts.session, sendFailed: true } }; flush(); },
      };
    }
  `;
  async function load(source) {
    const compiled = compileModule(source, { filename: 'draft-regression.svelte.js', dev: true }).js.code;
    const executable = compiled.replace(/(['"])(svelte\/internal\/client|test-runtime)\1/g, JSON.stringify(import.meta.resolve('svelte/internal/client')));
    return import(`data:text/javascript;base64,${Buffer.from(executable).toString('base64')}`);
  }
  const { run } = await load(source);
  const harness = run();
  try {
    assert.equal(harness.writes.length, 0);
    harness.hydrate();
    assert.equal(harness.writes.length, 1);
    harness.edit('new draft');
    assert.equal(harness.writes.length, 2);
    harness.fail();
    assert.equal(harness.writes.length, 3);
    assert.equal(harness.writes.at(-1).failed, true);
    harness.edit('');
    // Removing a failed draft also clears the derived failure flag once.
    assert.equal(harness.writes.length, 5);
    harness.edit('');
    assert.equal(harness.writes.length, 5);
  } finally {
    harness.dispose();
  }
  const beforeFix = await load(source.replace(
    'const sendFailed = composerDraftFailed;',
    'const sendFailed = composerDrafts[id]?.sendFailed === true;',
  ));
  const regression = beforeFix.run();
  try {
    assert.throws(() => regression.hydrate(), /draft effect keeps rescheduling itself/);
  } finally {
    regression.dispose();
  }
});
