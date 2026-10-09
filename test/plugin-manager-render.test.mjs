import assert from 'node:assert/strict';
import test from 'node:test';
import { translate } from '../packages/i18n/index.js';
import { createServer } from 'vite';

test('plugin manager hides uninstalled releases and shows the empty state in both default themes', async () => {
  const server = await createServer({
    server: { middlewareMode: true, ws: false, watch: null },
    appType: 'custom',
  });
  try {
    const { render } = await server.ssrLoadModule('svelte/server');
    const { default: Manager } = await server.ssrLoadModule('/src/lib/components/app/PluginManagerPanel.svelte');
    const { setUiTheme } = await server.ssrLoadModule('/src/lib/ui-kit/registry.ts');
    const removed = {
      id: 'removed', pluginId: 'external.removed', pluginVersion: '1.0.0',
      installed: false, enabled: false, runnable: false,
      dependencies: [], sessionProviders: [], manifest: { displayName: 'Removed plugin' },
    };
    const installed = {
      ...removed, id: 'installed', pluginId: 'external.installed', installed: true,
      manifest: { displayName: 'Installed plugin' },
    };
    const props = {
      busy: false,
      onInstall() {}, onEnabledChange() {},
      onUninstall() {}, onConfigure() {}, onCreateSession() {},
    };
    const { language } = await server.ssrLoadModule('/src/lib/i18n/runtime.ts');
    for (const locale of ['zh-CN', 'en']) for (const kit of ['light', 'dark']) {
      language.set({preference:locale,locale});
      setUiTheme(kit);
      const mixed = render(Manager, { props: { ...props, installations: [removed, installed] } }).body;
      assert.doesNotMatch(mixed, /Removed plugin|已卸载/, kit);
      assert.match(mixed, /Installed plugin/);
      assert.match(mixed, /external.installed/);
      assert.ok(!mixed.includes(translate(locale, 'plugins.empty')));
      const empty = render(Manager, { props: { ...props, installations: [removed] } }).body;
      assert.doesNotMatch(empty, /Removed plugin|已卸载/);
      assert.ok(empty.includes(translate(locale, 'plugins.empty')));
    }
  } finally {
    await server.close();
  }
});
