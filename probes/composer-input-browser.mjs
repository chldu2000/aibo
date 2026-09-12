import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';

// Seed only the preview data; exercise App's real rendering and event chain.
const server = await createServer({
  server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
  plugins: [{ name: 'composer-preview-session', enforce: 'pre', transform(code, id) {
    if (!id.endsWith('/src/App.svelte')) return;
    return code.replace('workspaces = previewWorkspaces;', `workspaces = previewWorkspaces;
      workspaceSessionMap = { 'preview-workspace': ['a', 'b'].map(id => ({
        id, workspaceId: 'preview-workspace', agent: 'dev.aibo.codex.agent',
        label: 'Input session ' + id, state: 'idle', archived: false,
        externalSessionId: null, pluginInstallationId: 'fixture', capabilities: [],
        createdAt: '2026-09-12', updatedAt: '2026-09-12'
      })) };
      setTimeout(() => { selectedSessionId = 'a'; }, 100);`);
  } }],
});
await server.listen();
const browser = await chromium.launch({ headless: true });
try {
  for (const kit of ['shadcn', 'material3']) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  await page.evaluate(async kit => (await import('/src/lib/ui-kit/registry.ts')).setUiKit(kit), kit);
  const input = page.locator('[data-composer-input]');
  await input.waitFor();
  await input.click();
  await page.keyboard.type('hello');
  assert.equal(await input.inputValue(), 'hello');
  await page.getByText('Input session b', { exact: true }).click();
  await input.click();
  await page.keyboard.type('world');
  assert.equal(await input.inputValue(), 'world');
  await page.keyboard.insertText('，你好');
  assert.equal(await input.inputValue(), 'world，你好');
  await page.getByRole('button', { name: '切换工作台呈现', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-presentation-layout="focus"][aria-busy="false"]'));
  assert.equal(await input.inputValue(), 'world，你好', 'host draft must survive presentation remount');
  await input.press('End');
  await page.keyboard.type('!');
  assert.equal(await input.inputValue(), 'world，你好!');
  await page.getByRole('button', { name: '恢复默认呈现', exact: true }).click();
  await page.getByText('Input session a', { exact: true }).click();
  await input.fill('back in a');
  assert.equal(await input.inputValue(), 'back in a');
  assert.equal(await page.getByRole('button', { name: '发送', exact: true }).isEnabled(), true);
  assert.deepEqual(errors, []);
  console.log(`${kit}: initial selection, session switches, typing and presentation remount passed`);
  await page.close();
  }
} finally { await browser.close(); await server.close(); }
