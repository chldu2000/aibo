import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { themeForColorScheme, themePaletteOptions } from '../src/lib/ui-kit/theme-options.ts';
const {themes} = JSON.parse(await readFile('src/lib/ui-kit/kits/material3/themes.json','utf8'));
const ak = JSON.parse(await readFile('src/lib/ui-kit/kits/ak-ui/themes.json','utf8'));

test('each palette exposes a paired light/dark choice with current-brightness previews', () => {
  for (const current of themes) {
    const options = themePaletteOptions(themes, current.id);
    assert.deepEqual(options.map(option => option.id), ['blue','forest','plum']);
    for (const option of options) {
      const target = themes.find(theme => theme.id === option.themeId);
      assert.equal(target.colorScheme, current.colorScheme);
      assert.equal(target.palette.id, option.id);
      assert.deepEqual(option.swatches, target.swatches);
    }
    for (const mode of ['light','dark']) {
      const target = themeForColorScheme(themes,current.id,mode);
      assert.equal(target.colorScheme,mode);
      assert.equal(target.palette.id,current.palette.id);
    }
  }
  for (const palette of ['blue','forest','plum']) {
    assert.deepEqual(themes.filter(theme => theme.palette.id === palette).map(theme => theme.colorScheme), ['light','dark']);
  }
});

test('palette selection changes only color tokens within the existing Material 3 design', () => {
  for (const theme of themes) {
    const original = themes.find(candidate => candidate.palette.id === 'blue' && candidate.colorScheme === theme.colorScheme);
    assert.deepEqual(Object.keys(theme.tokens), Object.keys(original.tokens));
    for (const key of Object.keys(theme.tokens)) if (!key.startsWith('--md-sys-color-')) assert.equal(theme.tokens[key],original.tokens[key],key);
  }
});

test('missing brightness does not switch palette and ungrouped kits retain their flat picker', () => {
  const partial=themes.filter(theme => theme.id !== 'forest-dark');
  assert.equal(themeForColorScheme(partial,'forest-light','dark'),undefined);
  assert.equal(themePaletteOptions(partial,'dark').find(option => option.id === 'forest').themeId,undefined);
  assert.equal(themeForColorScheme(themes,'unknown','light'),undefined);
  assert.deepEqual(themePaletteOptions(ak.themes,'light'),[]);
  assert.equal(themeForColorScheme(ak.themes,'light','dark').id,'dark');
  assert.deepEqual(themePaletteOptions([],''),[]);
  assert.deepEqual(themePaletteOptions([...themes,ak.themes[0]],'forest-light'),[]);
});
