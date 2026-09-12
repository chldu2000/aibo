import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('confirmed model catalogs survive running session navigation without fetching or leaking another session', async () => {
  const app = await readFile('src/App.svelte', 'utf8');
  const start = app.indexOf('  $effect(() => {\n    const session = selectedSession;\n    const enabled = desktop;', app.indexOf('async function applySessionAccess'));
  assert.ok(start > 0);
  const source = app.slice(start, app.indexOf('  async function applyModelChange', start))
    .replace('$effect(() => {', 'function refreshSelection() {')
    .replace('  });\n\n  async function loadSessionModels()', '  }\n\n  async function loadSessionModels()')
    .replace(': Promise<void>', '');
  const run = new Function('assert', `return (async () => {
    const sessionModelCatalogs = new Map();
    let selectedSession, selectedSessionId, sessionModelCatalog = null;
    let sessionModelOverride = null, sessionModelCatalogLoading = false;
    let sessionModelRequestGeneration = 0, errorMessage = null;
    const desktop = true, untrack = fn => fn(), toErrorMessage = String;
    const isSessionRunning = session => session.state === 'running';
    const calls = [];
    const getSessionModels = async id => {
      calls.push(id);
      return { current: { label: id }, currentReasoningEffort: id === 'codex' ? 'high' : 'medium' };
    };
    ${source}
    async function select(id, state) {
      selectedSessionId = id;
      selectedSession = { id, state, archived: false };
      sessionModelCatalog = null; // Navigation clears the selected pane.
      refreshSelection();
      await Promise.resolve();
    }
    await select('codex', 'idle');
    await select('pi', 'idle');
    for (const id of ['codex', 'pi', 'codex']) {
      await select(id, 'running');
      assert.equal(sessionModelCatalog?.current.label, id);
      assert.equal(sessionModelCatalog.currentReasoningEffort, id === 'codex' ? 'high' : 'medium');
      await loadSessionModels();
    }
    assert.deepEqual(calls, ['codex', 'pi']);
    await select('uncached', 'running');
    assert.equal(sessionModelCatalog, null);
    await select('codex', 'idle');
    assert.deepEqual(calls, ['codex', 'pi', 'codex']);
  })()`);
  await run(assert);
});
