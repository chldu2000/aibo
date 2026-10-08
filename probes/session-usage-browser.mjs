import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';

// Seed the real App; deliver usage through its production event handler and cache.
const server = await createServer({ server: { host: '127.0.0.1', port: 0, hmr: false, watch: null }, plugins: [{
  name: 'quota-fixture', enforce: 'pre', transform(code, id) {
    if (!id.endsWith('/src/App.svelte')) return;
    const anchor = 'workspaces = previewWorkspaces;';
    assert.ok(code.includes(anchor));
    return code.replace(anchor, `${anchor}
      workspaceSessionMap = { 'preview-workspace': ['quota-a', 'quota-b'].map(id => ({
        id, workspaceId: 'preview-workspace', agent: 'plugin', label: id, state: 'idle', archived: false,
        externalSessionId: null, pluginInstallationId: 'fixture', capabilities: [],
        createdAt: '2026-10-08', updatedAt: '2026-10-08'
      })) };
      window.quotaSelect = id => { selectedSessionId = id; };
      window.quotaEmit = (sessionId, usage) => handleAgentEvent({
        eventId: crypto.randomUUID(), workspaceId: 'preview-workspace', sessionId, turnId: null,
        type: 'usage.updated', occurredAt: new Date().toISOString(), source: {}, correlation: null, payload: { usage }
      });
      setTimeout(() => { selectedSessionId = 'quota-a'; }, 100);`);
  },
}] });
await server.listen();
const browser = await chromium.launch({ headless: true });
try {
  for (const kit of ['material3', 'ak-ui']) for (const theme of ['light', 'dark']) {
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(({ kit, theme }) => localStorage.setItem('aibo.appearance.v1', JSON.stringify({ kitId: kit, themeId: theme })), { kit, theme });
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
    await page.locator('[data-composer-input]').waitFor();
    await page.evaluate(() => {
      window.quotaSelect('quota-a');
      window.quotaEmit('quota-a', { totalTokens: 12, contextTokens: 50, contextWindow: 200, limits: [
        { id: 'five_hour', label: '5 小时', usedPercent: 24, observedAt: Date.now() / 1000, resetsAt: Date.now() / 1000 + 2 },
        { id: 'seven_day', label: '每周', usedPercent: 13, observedAt: Date.now() / 1000, resetsAt: null },
      ] });
    });
    const footer = page.getByRole('contentinfo', { name: '工作台状态' });
    await footer.getByText('5 小时剩余 76%', { exact: false }).waitFor();
    assert.match(await footer.textContent(), /上下文 25%/);
    assert.match(await footer.textContent(), /Token 12/);
    await footer.getByText('5 小时额度未知', { exact: false }).waitFor({ timeout: 6000 });
    assert.match(await footer.textContent(), /每周剩余 87%/);
    assert.equal(await footer.getByText('每周剩余', { exact: false }).getAttribute('title'), '重置时间未知');
    await page.evaluate(() => { window.quotaSelect('quota-b'); window.quotaEmit('quota-a', {}); });
    await page.waitForFunction(() => !document.querySelector('footer[aria-label="工作台状态"]').textContent.includes('剩余'));
    await page.evaluate(() => window.quotaSelect('quota-a'));
    await page.waitForFunction(() => !document.querySelector('footer[aria-label="工作台状态"]').textContent.includes('额度'));
    assert.deepEqual(errors, []);
    console.log(`${kit}/${theme}: event → cache → status, timed expiry and background reconnect clear passed`);
    await page.close();
  }
} finally { await browser.close(); await server.close(); }
