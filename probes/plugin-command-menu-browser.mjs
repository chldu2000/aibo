import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
// Seed only directory/session data. The real App -> TimelinePanel -> Composer
// path must decide whether a third-party provider gets a slash menu.
const server = await createServer({ server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: null }, plugins: [{
  name: 'cursor-command-menu-fixture', enforce: 'pre', transform(code, id) {
    if (!id.endsWith('/src/App.svelte')) return;
    return code.replace('workspaces = previewWorkspaces;', `workspaces = previewWorkspaces;
      workspaceSessionMap = { 'preview-workspace': [{
        id: 'cursor-menu', workspaceId: 'preview-workspace', agent: 'dev.aibo.cursor.agent',
        label: 'Cursor menu probe', state: 'idle', archived: false,
        externalSessionId: null, pluginInstallationId: 'fixture', capabilities: ['command.list'],
        createdAt: '2026-09-17', updatedAt: '2026-09-17'
      }] };
      setTimeout(() => { selectedSessionId = 'cursor-menu'; }, 100);`)
      .replace('visibleSessionCommands(selectedKind, builtinCommands, agentCommands)', `visibleSessionCommands(selectedKind, builtinCommands, [{name:'copy-request-id',description:'Native command',source:'agent',category:'agent',execution:'prompt'}])`);
  },
}] });
await server.listen();
const browser = await chromium.launch({ headless: true });
try {
  for (const kit of ['shadcn', 'material3']) {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
    await page.evaluate(async kit => (await import('/src/lib/ui-kit/registry.ts')).setUiKit(kit), kit);
    const input = page.locator('[data-composer-input]');
    await input.waitFor();
    await input.fill('/');
    const option = page.getByRole('option').filter({ hasText: '/copy-request-id' });
    await option.waitFor({ timeout: 3000 });
    await option.click();
    assert.equal(await input.inputValue(), '/copy-request-id ');
    await input.fill('/'); await input.press('Escape');
    assert.equal(await page.getByRole('option').count(), 0);
    console.log(`${kit}: Cursor slash menu and insertion passed`);
    await page.close();
  }
} finally { await browser.close(); await server.close(); }
