import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePresentationPlugin } from '../src/lib/ui-kit/presentation-plugin.ts';

const button = () => {};
const semanticView = () => {};
const theme = id => ({ id, label: id, description: '', colorScheme: 'dark', swatches: [], tokens: {} });
const defaults = {
  id: 'default', label: 'Default', description: '',
  themes: [theme('dark')], defaultThemeId: 'dark',
  adapter: { Button: button, SemanticView: semanticView },
  renderer: { id: 'dev.aibo.default', version: '1.0.0', semanticVersion: '1.0.0',
    core: ['collection', 'detail', 'settings', 'inspector'], optional: [] },
};
const definition = { id: 'example', label: 'Example', description: '' };

test('theme-only presentation inherits controls and core renderer without a second selection', () => {
  const plugin = resolvePresentationPlugin({ ...definition, themes: [theme('ocean')] }, defaults);
  assert.equal(plugin.defaultThemeId, 'ocean');
  assert.equal(plugin.adapter.Button, button);
  assert.equal(plugin.adapter.SemanticView, semanticView);
  assert.equal(plugin.renderer, defaults.renderer);
  assert.equal(defaults.defaultThemeId, 'dark');
});

test('partial control customization retains required defaults and does not mutate them', () => {
  const replacement = () => {};
  const plugin = resolvePresentationPlugin({ ...definition, components: { Button: replacement, SemanticView: undefined } }, defaults);
  assert.equal(plugin.adapter.Button, replacement);
  assert.equal(plugin.adapter.SemanticView, semanticView);
  assert.equal(defaults.adapter.Button, button);
  assert.equal(plugin.defaultThemeId, 'dark');
});

test('invalid theme selection and incomplete core semantics cannot become active registrations', () => {
  for (const override of [
    { id: ' ' }, { themes: [] }, { defaultThemeId: 'missing' },
    { themes: [theme('same'), theme('same')] },
    { renderer: { ...defaults.renderer, core: ['detail'] } },
  ]) assert.throws(() => resolvePresentationPlugin({ ...definition, ...override }, defaults));
});
