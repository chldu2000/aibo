import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeDefaultAppearance as normalizeAppearance } from '../src/lib/ui-kit/appearance-selection.ts';
import { readFile } from 'node:fs/promises';

const metadata = JSON.parse(await readFile(new URL('../src/lib/ui-kit/kits/ak-ui/themes.json', import.meta.url), 'utf8'));
const material = JSON.parse(await readFile(new URL('../src/lib/ui-kit/kits/material3/themes.json', import.meta.url), 'utf8'));
const normalizeDefaultAppearance = value => normalizeAppearance(value, [metadata, material]);

test('old built-in appearances migrate brightness to the unified default', () => {
  for (const kitId of ['shadcn', 'material3']) {
    const ids = kitId === 'shadcn' ? ['zinc', 'blue', 'emerald', 'light'] : ['ocean', 'sage', 'violet', 'daylight'];
    for (const themeId of ids) {
      const input = { kitId, themeId, draft: 'not owned by appearance' };
      assert.deepEqual(normalizeDefaultAppearance(input), { kitId: 'ak-ui', themeId: ['light', 'daylight'].includes(themeId) ? 'light' : 'dark' });
      assert.equal(input.draft, 'not owned by appearance');
      assert.equal(input.kitId, kitId);
    }
  }
});

test('appearance migration is idempotent and rejects corrupt/unknown or external selections', () => {
  for (const {id: kitId, themes} of [metadata, material]) for (const {id: themeId} of themes) {
    const next = { kitId, themeId };
    assert.deepEqual(normalizeDefaultAppearance(normalizeDefaultAppearance(next)), next);
  }
  for (const value of [null, false, 42, {}, {kitId:'shadcn',themeId:'unknown'}, {kitId:'external',themeId:'light'}, {kitId:'ak-ui',themeId:'zinc'}, {kitId:'material3',themeId:'invalid'}]) assert.equal(normalizeDefaultAppearance(value), null);
  for (const kitId of ['__proto__', 'constructor', 'toString']) assert.equal(normalizeDefaultAppearance({ kitId, themeId: 'light' }), null);
});

test('default themes keep all workbench surfaces in the same brightness and text legible', () => {
  const luminance = hex => {
    const channels = hex.replace('#', '').match(/../g).map(value => { const s = parseInt(value,16)/255; return s <= .04045 ? s/12.92 : ((s+.055)/1.055)**2.4; });
    return channels[0]*.2126 + channels[1]*.7152 + channels[2]*.0722;
  };
  assert.equal(metadata.id, 'ak-ui');
  assert.equal(metadata.defaultThemeId, 'light');
  assert.deepEqual(metadata.themes.map(theme => theme.colorScheme), ['light', 'dark']);
  for (const theme of metadata.themes) {
    for (const role of ['canvas','panel','muted','raised']) {
      const surface = luminance(theme.tokens[`--ak-surface-${role}`]);
      assert.equal(surface > .5, theme.colorScheme === 'light', `${theme.id}/${role} must stay in its theme`);
      for (const textRole of ['primary','secondary']) {
        const text = luminance(theme.tokens[`--ak-text-${textRole}`]);
        assert.ok((Math.max(text,surface)+.05)/(Math.min(text,surface)+.05) >= 4.5, `${theme.id}/${role}/${textRole}: readable normal text`);
      }
    }
  }
});
