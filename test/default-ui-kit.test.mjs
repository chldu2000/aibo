import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

test('one default kit exposes both themes and legacy callers cannot restore retired defaults', async () => {
  const server = await createServer({ server: { middlewareMode: true, ws: false, watch: null }, appType: 'custom' });
  try {
    const { get } = await server.ssrLoadModule('svelte/store');
    const registry = await server.ssrLoadModule('/src/lib/ui-kit/registry.ts');
    assert.deepEqual(registry.availableUiKits.map(kit => kit.id), ['ak-ui']);
    for (const theme of ['light', 'dark']) {
      registry.setUiTheme(theme);
      for (const legacy of ['shadcn', 'material3']) {
        registry.setUiKit(legacy);
        assert.deepEqual(get(registry.appearanceSelection), { kitId: 'ak-ui', themeId: theme });
      }
      registry.setUiKit('external.unregistered');
      registry.setUiTheme('invalid');
      assert.deepEqual(get(registry.appearanceSelection), { kitId: 'ak-ui', themeId: theme });
      assert.equal(get(registry.activeTheme).colorScheme, theme);
    }
    const adapter = get(registry.activeUiKit);
    for (const role of ['Button','AlertDialog','WorkbenchChrome','ManagementCenter','SemanticView','ModelMatrix','RepositorySelect','SessionControlMark','SubagentDialog','AttachmentList']) assert.equal(typeof adapter[role], 'function', role);
  } finally { await server.close(); }
});
