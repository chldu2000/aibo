import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const server = await createServer({
  server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: null },
  plugins: [{ name: 'session-tabs-fixture', enforce: 'pre', transform(code, id) {
    if (!id.endsWith('/src/App.svelte')) return;
    return code.replace('workspaces = previewWorkspaces;', `workspaces = previewWorkspaces;
      workspaceSessionMap = { 'preview-workspace': ['a', 'b'].map(id => ({
        id, workspaceId: 'preview-workspace', agent: 'plugin', label: 'Tab session ' + id,
        state: 'idle', archived: false, externalSessionId: null, pluginInstallationId: 'third-party',
        capabilities: [], createdAt: '2026-09-12', updatedAt: '2026-09-12'
      })) };
      setTimeout(() => { selectedSessionId = 'a'; }, 100);`);
  } }],
});
await server.listen();
const browser = await chromium.launch({ headless: true });
try {
  for (const kit of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
    await page.evaluate(async kit => (await import('/src/lib/ui-kit/registry.ts')).setUiTheme(kit), kit);
    await page.getByText('Tab session a', { exact: true }).click();
    const input = page.locator('[data-composer-input]'); await input.fill('保留草稿');
    await page.getByRole('tablist', { name: '会话视图' }).getByRole('tab', { name: '执行记录', exact: true }).click();
    await page.getByRole('tabpanel', { name: '执行记录', exact: true }).getByText('本会话暂无执行记录。').waitFor();
    assert.equal(await input.inputValue(), '保留草稿');
    await page.getByRole('tablist', { name: '会话视图' }).getByRole('tab', { name: '执行记录', exact: true }).press('ArrowRight');
    await page.locator('#session-panel-changes').getByText('读取 Git 变更需要桌面宿主。').waitFor();
    assert.equal(await page.getByRole('tablist', { name: '会话视图' }).getByRole('tab', { name: '变更', exact: true }).getAttribute('aria-selected'), 'true');
    assert.equal(await input.inputValue(), '保留草稿');
    await page.getByText('Tab session b', { exact: true }).click();
    assert.equal(await page.getByRole('tablist', { name: '会话视图' }).getByRole('tab', { name: '对话', exact: true }).getAttribute('aria-selected'), 'true');
    await page.getByText('Tab session a', { exact: true }).click();
    await page.locator('#session-panel-changes').waitFor();
    await page.getByRole('tablist', { name: '会话视图' }).getByRole('tab', { name: '变更', exact: true }).press('Home');
    await page.getByRole('tabpanel', { name: '对话', exact: true }).waitFor();
    assert.deepEqual(errors, []);
    await page.close(); console.log(`${kit}: local tabs, keyboard, per-session selection, draft and missing desktop passed`);
  }
} finally { await browser.close(); await server.close(); }
