import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const server = await createServer({ server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: null } });
await server.listen();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = []; page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(10000);
await mkdir('/tmp/aibo-host-confirmation', { recursive: true });
try {
  await page.addInitScript(() => {
    const defaults = { git: 'always-allow', projectAction: 'always-allow', turnRestore: 'always-allow', capabilityWrite: 'always-allow', viewWrite: 'always-allow' };
    const preferences = () => JSON.parse(localStorage.getItem('probe.confirmations') || JSON.stringify(defaults));
    window.confirmationCalls = []; let callback = 0;
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback(fn) { const id = ++callback; window['_' + id] = fn; return id; },
      unregisterCallback(id) { delete window['_' + id]; },
      async invoke(command, args = {}) {
        window.confirmationCalls.push({ command, args });
        if (command.startsWith('plugin:event|')) return 1;
        if (command === 'get_app_snapshot') return { platform: 'macos', appVersion: 'probe', workspaceCount: 0, diagnostics: [] };
        if (command === 'read_workspace_preferences') return { trustNewWorkspaces: true };
        if (command === 'read_host_confirmation_preferences') {
          if (window.failConfirmationRead) throw Error('读取确认设置失败');
          return preferences();
        }
        if (command === 'save_host_confirmation_preference') {
          await new Promise(resolve => setTimeout(resolve, 50));
          if (window.failConfirmationSave) throw Error('保存确认设置失败');
          const next = { ...preferences(), [args.category]: args.policy };
          localStorage.setItem('probe.confirmations', JSON.stringify(next)); return next;
        }
        if (command === 'get_presentation_selection') return null;
        return [];
      },
    };
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  const open = async () => {
    await page.getByRole('button', { name: '工作台设置', exact: true }).click();
    await page.getByRole('tab', { name: '工作区', exact: true }).click();
    await page.getByRole('heading', { name: '宿主操作确认', exact: true }).waitFor();
  };
  const select = label => page.getByRole('combobox', { name: `${label}确认策略`, exact: true });
  const labels = ['Git 操作', '工程动作', '恢复本轮变更', '插件能力写入', '插件视图写入'];
  await open();
  for (const label of labels) assert.equal(await select(label).inputValue(), 'always-allow');
  await page.screenshot({ path: '/tmp/aibo-host-confirmation/light.png' });
  for (const label of labels) {
    await select(label).selectOption('ask');
    await page.waitForFunction(() => !document.querySelector('select[aria-label="Git 操作确认策略"]').disabled);
    assert.equal(await select(label).inputValue(), 'ask');
  }
  assert.equal(await page.getByRole('switch', { name: '新增工作区默认信任' }).isChecked(), true);
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.reload(); await open();
  for (const label of labels) assert.equal(await select(label).inputValue(), 'ask');
  await page.evaluate(() => { window.failConfirmationSave = true; });
  await select('Git 操作').selectOption('always-allow');
  await page.getByRole('alert').filter({ hasText: '保存确认设置失败' }).waitFor();
  assert.equal(await select('Git 操作').inputValue(), 'ask');
  await page.evaluate(() => { window.failConfirmationSave = false; });
  await select('Git 操作').selectOption('always-allow');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('probe.confirmations')).git === 'always-allow');
  assert.equal(await select('工程动作').inputValue(), 'ask');
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.evaluate(() => { window.failConfirmationRead = true; }); await open();
  await page.getByRole('alert').filter({ hasText: '读取确认设置失败' }).waitFor();
  for (const label of labels) assert(await select(label).isDisabled());
  await page.evaluate(() => { window.failConfirmationRead = false; });
  await page.getByRole('button', { name: '重新读取确认设置', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('select[aria-label="Git 操作确认策略"]').disabled);
  await page.getByRole('tab', { name: '外观', exact: true }).click();
  await page.locator('.appearance-theme-option').filter({ hasText: '深色' }).click();
  await page.getByRole('tab', { name: '工作区', exact: true }).click();
  await page.screenshot({ path: '/tmp/aibo-host-confirmation/dark.png' });
  // macOS headless Chromium does not commit native popup choices from key events,
  // even for an isolated plain select. Verify keyboard reachability here;
  // selection/persistence is exercised above through Playwright's selectOption.
  await select('Git 操作').focus(); await page.keyboard.press('Tab');
  assert.equal(await select('工程动作').evaluate(element => document.activeElement === element), true);
  await page.setViewportSize({ width: 390, height: 844 });
  await select('插件视图写入').scrollIntoViewIfNeeded();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const bounds = await select('插件视图写入').boundingBox(); assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390);
  await page.screenshot({ path: '/tmp/aibo-host-confirmation/narrow.png' });
  assert.deepEqual(errors, []);
  assert(await page.evaluate(() => window.confirmationCalls.filter(call => call.command === 'save_host_confirmation_preference').every(call => Object.keys(call.args).sort().join(',') === 'category,policy')));
  console.log('PASS: five defaults, independent saves, persisted reload, failure/retry, keyboard focus, light/dark and narrow settings. Native IPC mocked.');
} catch (error) {
  await page.screenshot({ path: '/tmp/aibo-host-confirmation/failure.png' }); throw error;
} finally { await browser.close(); await server.close(); }
