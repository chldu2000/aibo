import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const server = await createServer({ server: { host: '127.0.0.1', port: 0, hmr: false, watch: null } });
await server.listen();
const browser = await chromium.launch({ headless: true });
try {
 for (const kit of ['material3', 'ak-ui']) for (const theme of ['light', 'dark']) {
  const page = await browser.newPage({locale:'zh-CN', viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  await page.evaluate(async ({kit,theme}) => { const r = await import('/src/lib/ui-kit/registry.ts'); r.setUiKit(kit); r.setUiTheme(theme); }, {kit,theme});
  const sidebar = page.locator('[data-ui-component="workspace-sidebar"]');
  // M3 collapses to an 80px navigation rail; ak-ui keeps its 56px rail.
  const railWidth = kit === 'material3' ? 80 : 56;
  const toggle = page.getByRole('button', { name: '收起导航栏', exact: true });
  await toggle.waitFor(); const before = await toggle.boundingBox(); const expanded = await sidebar.boundingBox();
  const create = await page.getByRole('button', { name: '新建会话', exact: true }).boundingBox();
  assert.equal(create.y + create.height / 2, before.y + before.height / 2, 'primary actions share a center line');
  assert(create.x >= before.x + before.width, 'new session sits beside the toggle');
  await page.screenshot({ path: `/tmp/aibo-sidebar-expanded-${kit}-${theme}.png` });
  await toggle.click();
  const expand = page.getByRole('button', { name: '展开导航栏', exact: true });
  await expand.waitFor();
  const after = await expand.boundingBox();
  assert.equal(after.x, before.x); assert.equal(after.y, before.y);
  assert.equal(Math.round((await sidebar.boundingBox()).width), railWidth);
  assert.equal(await page.getByRole('separator', { name: '调整工作区与会话宽度' }).count(), 0);
  assert.equal(await sidebar.getByRole('button').count(), 5);
  await page.getByRole('button', { name: '新建会话', exact: true }).click();
  await page.getByRole('group', { name: '选择 Agent 创建会话' }).waitFor();
  await page.keyboard.press('Escape');
  await page.screenshot({ path: `/tmp/aibo-sidebar-${kit}-${theme}.png` });
  await page.reload(); await expand.waitFor();
  assert.equal(Math.round((await sidebar.boundingBox()).width), railWidth);
  await expand.press('Enter'); await toggle.waitFor();
  assert.equal(Math.round((await sidebar.boundingBox()).width), Math.round(expanded.width));
  await page.getByRole('button', { name: '工作台设置', exact: true }).click();
  await page.getByRole('dialog').waitFor(); await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 700, height: 850 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []); await page.close();
  console.log(`${kit} ${theme}: collapse, menu, persistence, keyboard, settings, narrow viewport passed`);
 }
} finally { await browser.close(); await server.close(); }
