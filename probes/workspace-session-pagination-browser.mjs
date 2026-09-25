import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const server = await createServer({
  server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: null },
  plugins: [{ name: 'workspace-pagination-fixture', enforce: 'pre', transform(code, id) {
    if (!id.endsWith('/src/App.svelte')) return;
    return code.replace('workspaces = previewWorkspaces;', `
      workspaces = ['preview-workspace', 'second-workspace', 'small-workspace'].map(id => ({
        ...previewWorkspaces[0], id, label: id, trust: 'trusted',
      }));
      workspaceSessionMap = Object.fromEntries(workspaces.map(workspace => [workspace.id,
        Array.from({ length: workspace.id === 'small-workspace' ? 5 : 12 }, (_, index) => ({
          id: workspace.id + '-' + index, workspaceId: workspace.id, agent: 'plugin',
          label: workspace.id + ' session ' + index, state: 'idle', archived: false,
          externalSessionId: null, capabilities: [], createdAt: '2026-09-01',
          updatedAt: new Date(Date.UTC(2026, 8, 25, 0, 0, -index)).toISOString()
        }))
      ]));
      (window as any).updateOldSession = (contentChanged: boolean) => {
        const old = workspaceSessionMap['preview-workspace'].find(s => s.id === 'preview-workspace-11')!;
        workspaceSessionMap = upsertSession(workspaceSessionMap, {
          ...old, state: 'idle', label: 'Updated old session',
          updatedAt: contentChanged ? '2026-09-26T00:00:00Z' : old.updatedAt,
        });
      };`);
  } }],
});
await server.listen();
const browser = await chromium.launch({ headless: true });
try {
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
    await page.evaluate(async value => (await import('/src/lib/ui-kit/registry.ts')).setUiTheme(value), theme);
    const first = page.locator('#workspace-sessions-preview-workspace');
    const rows = first.locator('.session-item-row');
    const more = first.getByRole('button', { name: '加载更多会话', exact: true });
    await more.waitFor();
    assert.equal(await rows.count(), 5);
    await first.locator('.session-item').first().click();
    const composer = page.locator('[data-composer-input]');
    await composer.fill('分页时保留草稿');
    await more.focus();
    await more.press('Enter');
    await rows.nth(9).waitFor();
    assert.equal(await rows.count(), 10);
    await page.getByRole('button', { name: 'second-workspace，可信', exact: true }).click();
    const second = page.locator('#workspace-sessions-second-workspace');
    assert.equal(await second.locator('.session-item-row').count(), 5);
    assert.equal(await rows.count(), 10);
    await more.click();
    await rows.nth(11).waitFor();
    assert.equal(await rows.count(), 12);
    assert.equal(await more.count(), 0);
    assert.equal(await composer.inputValue(), '分页时保留草稿');
    const toggle = page.getByRole('button', { name: 'preview-workspace，可信', exact: true });
    await toggle.click();
    assert.equal(await rows.count(), 0);
    await toggle.click();
    await more.waitFor();
    assert.equal(await rows.count(), 5);
    await more.click();
    await page.getByRole('button', { name: '筛选会话', exact: true }).click();
    await page.getByRole('button', { name: '应用会话筛选', exact: true }).click();
    assert.equal(await rows.count(), 5);
    await page.getByRole('button', { name: 'small-workspace，可信', exact: true }).click();
    const small = page.locator('#workspace-sessions-small-workspace');
    assert.equal(await small.locator('.session-item-row').count(), 5);
    assert.equal(await small.getByRole('button', { name: '加载更多会话', exact: true }).count(), 0);
    const originalOrder = await first.locator('.session-item-label').allTextContents();
    await page.getByRole('button', { name: '全局搜索', exact: true }).click();
    await page.getByRole('combobox', { name: '全局搜索内容' }).fill('preview-workspace session 0');
    await page.getByRole('option').filter({ hasText: 'preview-workspace session 0' }).first().click();
    await page.getByRole('dialog', { name: '全局搜索', exact: true }).waitFor({ state: 'detached' });
    assert.deepEqual(await first.locator('.session-item-label').allTextContents(), originalOrder,
      'opening a search result must preserve content-activity ordering and pagination');
    await page.evaluate(() => window.updateOldSession(false));
    assert.deepEqual(await first.locator('.session-item-label').allTextContents(), originalOrder,
      'metadata-only updates must not bring a hidden old session into the first page');
    await page.evaluate(() => window.updateOldSession(true));
    await first.getByText('Updated old session', { exact: true }).waitFor();
    assert.equal(await first.locator('.session-item-label').first().innerText(), 'Updated old session');
    assert.equal(await rows.count(), 5);
    assert.equal(await composer.inputValue(), '分页时保留草稿');
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`${theme}: paging, keyboard, workspace isolation, collapse/filter reset, content ordering and draft retention passed`);
  }
} finally {
  await browser.close();
  await server.close();
}
