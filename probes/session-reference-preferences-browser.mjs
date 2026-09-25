import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const server = await createServer({ server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: null } });
await server.listen();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = []; page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(10000);
await mkdir('/tmp/aibo-reference-preferences', { recursive: true });
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
        if (command === 'read_session_reference_preferences') {
          if (window.failReferenceRead) throw Error('读取引用设置失败');
          return JSON.parse(localStorage.getItem('probe.references') || '{"messageLimit":12}');
        }
        if (command === 'save_session_reference_preferences') {
          await new Promise(resolve => setTimeout(resolve, 50));
          if (window.failReferenceSave) throw Error('保存引用设置失败');
          const next = { messageLimit: args.messageLimit };
          localStorage.setItem('probe.references', JSON.stringify(next)); return next;
        }
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
    await page.getByRole('heading', { name: '会话引用', exact: true }).waitFor();
  };
  const range = page.getByRole('combobox', { name: '引用消息范围', exact: true });
  const count = page.getByRole('spinbutton', { name: '最多传递条数' });
  const choose = async text => { await range.click(); await page.getByRole('option', { name: text, exact: true }).click(); };
  const saved = async limit => { await page.waitForFunction(limit => JSON.parse(localStorage.getItem('probe.references') || '{}').messageLimit === limit, limit); await page.waitForFunction(() => !document.querySelector('button[aria-label="引用消息范围"]').disabled); };
  await open(); assert.equal(await count.inputValue(), '12');
  await count.fill('25'); await page.getByRole('button', { name: '保存条数', exact: true }).click(); await saved(25);
  await choose('全部用户 / Agent 消息'); await saved(null); assert.equal(await count.count(), 0);
  await page.getByRole('button', { name: '关闭设置', exact: true }).click(); await page.reload(); await open();
  assert.match(await range.innerText(), /全部/);
  await choose('最近若干条消息'); await saved(12);
  await count.fill('0'); assert(await page.getByRole('button', { name: '保存条数', exact: true }).isDisabled());
  await count.fill('2.5'); assert(await page.getByRole('button', { name: '保存条数', exact: true }).isDisabled());
  await page.evaluate(() => { window.failReferenceSave = true; });
  await choose('全部用户 / Agent 消息'); await page.getByRole('alert').filter({ hasText: '保存引用设置失败' }).waitFor();
  assert.match(await range.innerText(), /最近/);
  await page.evaluate(() => { window.failReferenceSave = false; });
  await count.fill('1'); await page.getByRole('button', { name: '保存条数', exact: true }).click(); await saved(1);
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.evaluate(() => { window.failReferenceRead = true; }); await open();
  await page.getByRole('alert').filter({ hasText: '读取引用设置失败' }).waitFor(); assert(await range.isDisabled());
  await page.evaluate(() => { window.failReferenceRead = false; });
  await page.getByRole('button', { name: '重新读取引用设置', exact: true }).click(); await count.waitFor();
  for (const kit of ['Aibo · Material 3', 'Aibo · ak-ui']) for (const theme of ['浅色', '深色']) {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.getByRole('tab', { name: '外观', exact: true }).click();
    await page.locator('.appearance-kit-option').filter({ hasText: kit }).click();
    await page.locator('.appearance-theme-option, .appearance-mode-option').filter({ hasText: theme }).click();
    await page.getByRole('tab', { name: '工作区', exact: true }).click();
    await range.focus(); await page.keyboard.press('Space'); await page.keyboard.press('Home'); await page.keyboard.press('Enter'); await saved(null);
    await choose('最近若干条消息'); await saved(1);
    await page.screenshot({ path: `/tmp/aibo-reference-preferences/${kit}-${theme}.png` });
    await page.setViewportSize({ width: 390, height: 844 }); await count.scrollIntoViewIfNeeded();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const bounds = await count.boundingBox(); assert(bounds && bounds.width >= 80 && bounds.x >= 0 && bounds.x + bounds.width <= 390);
  }
  assert.deepEqual(errors, []);
  console.log('PASS: App settings, all/recent/count, reload, invalid counts, failure/retry, keyboard and both kits light/dark/narrow. Native IPC mocked.');
} catch (error) {
  await page.screenshot({ path: '/tmp/aibo-reference-preferences/failure.png' }); throw error;
} finally { await browser.close(); await server.close(); }
