import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createViewStateStore } from '../src/lib/app/view-state-storage.ts';
import { readPersistedSelection, writePersistedSelection, selectedSessionStorageKey } from '../src/lib/app/selection-storage.ts';
import { writeComposerDrafts, readComposerDrafts } from '../src/lib/app/composer-draft-storage.ts';

const storage = () => { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }; };

test('view state survives remounts, separates windows and scopes, and expires navigation only', () => {
  const disk = storage(); let now = 100;
  const scope = { workspaceId: 'a', contributionId: 'git' };
  const saved = { selection: 'file-a', detail: 'file-a', offset: 50, layout: 'sidebar' };
  const store = createViewStateStore(disk, 'main', () => now);
  store.write(scope, saved); saved.selection = 'mutated';
  const restored = createViewStateStore(disk, 'main', () => now);
  assert.equal(restored.read(scope).selection, 'file-a');
  assert.equal(restored.read({ ...scope, workspaceId: 'b' }).selection, null);
  assert.equal(restored.read({ ...scope, contributionId: 'other' }).selection, null);
  assert.equal(createViewStateStore(disk, 'secondary').read(scope).selection, null);
  now += 31 * 86400000;
  assert.equal(restored.read(scope).selection, null);
});

test('window selection migrates the main window only and cleared selection cannot resurrect', () => {
  const disk = storage(); const selection = { workspaceId: 'a', sessionId: 'one' };
  disk.setItem(selectedSessionStorageKey, JSON.stringify(selection));
  assert.deepEqual(readPersistedSelection(disk, 'main'), selection);
  assert.equal(readPersistedSelection(disk, 'secondary'), null);
  writePersistedSelection(disk, selection, 'secondary');
  writePersistedSelection(disk, null, 'main');
  assert.equal(readPersistedSelection(disk, 'main'), null);
  assert.deepEqual(readPersistedSelection(disk, 'secondary'), selection);
});

test('draft persistence does not discard older drafts and plugin panels share Core state', async () => {
  const disk = storage();
  const drafts = Object.fromEntries(Array.from({ length: 70 }, (_, id) => [String(id), { text: `draft ${id}`, updatedAt: '2000-01-01' }]));
  writeComposerDrafts(disk, drafts);
  assert.deepEqual(readComposerDrafts(disk), drafts);
  const app = await readFile(new URL('../src/App.svelte', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /pluginDrafts|pluginTimeline|pluginSelection/);
  assert.match(app, /prompt=\{pluginSessionId \? composerText/);
  assert.match(app, /timeline=\{timeline\.filter/);
  assert.match(app, /onSelectSession=\{guard\('onSelectSession', selectSession\)\}/);
});
