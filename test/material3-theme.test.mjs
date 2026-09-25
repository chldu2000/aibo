import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const postcss = createRequire(require.resolve('vite'))('postcss');

const { themes } = JSON.parse(await readFile('src/lib/ui-kit/kits/material3/themes.json', 'utf8'));

function luminance(hex) {
  assert.match(hex, /^#[0-9a-f]{6}$/i);
  const [r, g, b] = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return .2126 * r + .7152 * g + .0722 * b;
}

test('Material 3 text, selected states, primary actions and focus remain legible in both themes', () => {
  for (const theme of themes) {
    const resolve = key => {
      const value = theme.tokens[key];
      assert.ok(value, `missing token ${key}`);
      return value.startsWith('var(') ? resolve(value.slice(4, -1)) : value;
    };
    const contrast = (fg, bg) => {
      const a = luminance(resolve(fg)), b = luminance(resolve(bg));
      return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    };
    for (const role of ['surface', 'surface-container-lowest', 'surface-container-low', 'surface-container', 'surface-container-high', 'surface-container-highest']) {
      const bg = `--md-sys-color-${role}`;
      assert.equal(luminance(resolve(bg)) > .5, theme.colorScheme === 'light');
      for (const fg of ['--aibo-text', '--aibo-muted']) assert.ok(contrast(fg, bg) >= 4.5, `${theme.id}: ${fg} on ${role}`);
      assert.ok(contrast('--aibo-focus', bg) >= 3, `${theme.id}: focus on ${role}`);
    }
    for (const [fg, bg] of [
      ['--primary-foreground', '--primary'], ['--destructive-foreground', '--destructive'], ['--aibo-selected-ink', '--aibo-selected'],
      ['--md-sys-color-on-primary-container', '--md-sys-color-primary-container'],
      ['--aibo-success-text', '--aibo-success-surface'], ['--aibo-danger-text', '--aibo-danger-surface'],
      ['--aibo-warning-text', '--aibo-warning-surface'], ['--aibo-info-text', '--aibo-info-surface'],
    ]) assert.ok(contrast(fg, bg) >= 4.5, `${theme.id}: ${fg} on ${bg}`);
  }
});

test('each kit owns its selectors, tokens, imports and animation names', async () => {
  for (const kit of ['ak-ui', 'material3']) {
    const files = [`src/lib/ui-kit/kits/${kit}.css`, ...(await readdir(`src/lib/ui-kit/kits/${kit}`)).filter(name => name.endsWith('.css')).map(name => `src/lib/ui-kit/kits/${kit}/${name}`)];
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      const css = postcss.parse(source);
      css.walkRules(rule => {
        if (rule.parent.type === 'atrule' && rule.parent.name.endsWith('keyframes')) return;
        for (const selector of rule.selectors) assert.ok(selector.includes(`data-ui-kit='${kit}'`), `${file}: ${selector}`);
      });
      css.walkAtRules('keyframes', rule => assert.ok(rule.params.startsWith(kit === 'ak-ui' ? 'ak-' : 'md-'), `${file}: ${rule.params}`));
      if (kit === 'material3') {
        assert.doesNotMatch(source, /--ak-|@import[^;]*ak-ui/);
        assert.deepEqual(source.match(/#[0-9a-f]{3,8}\b/gi) ?? [], [], file);
      } else assert.doesNotMatch(source, /data-ui-kit='material3'/);
    }
  }
});

test('shared controls and primitives carry no kit-specific visual defaults', async () => {
  const shared = 'src/lib/ui-kit/kits/shared';
  for (const name of await readdir(shared)) {
    if (!name.endsWith('.svelte')) continue;
    const source = await readFile(`${shared}/${name}`, 'utf8');
    assert.doesNotMatch(source, /<style|--ak-|--md-|from ['"][^'"]*\/(?:ak-ui|material3)\//, name);
  }
  for (const [folder, file] of [['input','input'],['textarea','textarea'],['badge','badge'],['card','card'],['label','label']]) {
    const source = await readFile(`src/lib/components/ui/${folder}/${file}.svelte`, 'utf8');
    assert.doesNotMatch(source, /rounded-|shadow-|bg-\[|text-\[|border-\[/, file);
  }
  const base = postcss.parse(await readFile('src/lib/ui-kit/kits/base.css', 'utf8'));
  base.walkDecls(declaration => {
    if (declaration.parent.selector === ':root') return; // Document bootstrap, before a kit is mounted.
    assert.doesNotMatch(declaration.prop, /^(?:color|background|border(?!-collapse|-spacing)|box-shadow|font|letter-spacing|outline|animation|transition|clip-path)/, declaration.toString());
  });
});
