// Built-in kits as preinstalled releases: selection is committed against the host release
// store, the localStorage entry is only a first-paint cache, and built-ins stay out of
// package management.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const release = async (kit, digest) => ({ digest, enabled: true, source: 'builtin',
  manifest: JSON.parse(await readFile(`src/lib/ui-kit/kits/${kit}/presentation.json`, 'utf8')) });
const builtins = [await release('material3', 'm'.repeat(64)), await release('ak-ui', 'k'.repeat(64))];
const server = await createServer({ server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: null } });
await server.listen();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.addInitScript(builtins => {
    // A cache left by the previous localStorage-only selector.
    if (!sessionStorage.getItem('probe.started')) {
      sessionStorage.setItem('probe.started', '1');
      localStorage.setItem('aibo.appearance.v1', JSON.stringify({ kitId: 'ak-ui', themeId: 'dark' }));
    }
    let callback = 0; window.selectionWrites = [];
    const saved = () => JSON.parse(localStorage.getItem('probe.presentation.selection') || 'null');
    window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback(fn) { const id = ++callback; window['_' + id] = fn; return id; }, unregisterCallback(id) { delete window['_' + id]; },
      async invoke(command, args = {}) {
        if (command === 'read_workspace_preferences') return { trustNewWorkspaces: true };
        if (command === 'list_presentation_packages') return builtins;
        if (command === 'get_presentation_selection') return saved();
        if (command === 'read_presentation_package') {
          const value = builtins.find(release => release.digest === args.digest);
          if (!value) throw Error('presentation_unavailable');
          return { release: value, resources: {} };
        }
        if (command === 'select_presentation_package') {
          if ((saved()?.digest ?? null) !== args.expectedDigest) throw Error('presentation_selection_superseded');
          window.selectionWrites.push(args);
          localStorage.setItem('probe.presentation.selection', JSON.stringify(args.digest ? { digest: args.digest, themeId: args.themeId } : null));
          return;
        }
        if (command.startsWith('plugin:event|')) return 1;
        if (command === 'get_app_snapshot') return { platform: 'macos', appVersion: 'probe', workspaceCount: 0, diagnostics: [] };
        return [];
      } };
  }, builtins);
  const shell = page.locator('.app-shell');
  const appearance = async () => [await shell.getAttribute('data-ui-kit'), await shell.getAttribute('data-ui-theme')];
  const committed = () => page.evaluate(() => JSON.parse(localStorage.getItem('probe.presentation.selection') || 'null'));

  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
  await page.getByRole('button', { name: /^打开工作台设置/ }).waitFor();
  await page.waitForFunction(() => localStorage.getItem('probe.presentation.selection') !== null);
  assert.deepEqual(await committed(), { digest: 'k'.repeat(64), themeId: 'dark' }, 'first start records the cached kit against its release');
  assert.deepEqual(await appearance(), ['ak-ui', 'dark']);

  await page.getByRole('button', { name: /^打开工作台设置/ }).click();
  assert.equal(await page.locator('.appearance-kit-option').count(), 2, 'built-in releases are listed once, through their kits');
  await page.locator('.appearance-kit-option').filter({ hasText: 'Aibo · Material 3' }).click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('probe.presentation.selection')).digest.startsWith('m'));
  assert.deepEqual(await committed(), { digest: 'm'.repeat(64), themeId: 'dark' }, 'kit switch keeps brightness');
  assert.deepEqual(await appearance(), ['material3', 'dark']);
  await page.getByRole('tab', { name: '插件与能力', exact: true }).click();
  const packages = page.getByRole('region', { name: '皮肤插件管理' });
  assert.equal(await packages.getByText('Aibo · Material 3').count(), 0, 'built-ins cannot be disabled or uninstalled');
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();

  await page.getByRole('button', { name: '切换明暗主题', exact: true }).click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('probe.presentation.selection')).themeId === 'light');
  assert.deepEqual(await appearance(), ['material3', 'light']);

  // The committed selection is authoritative: a stale cache is corrected on the next start.
  await page.evaluate(() => localStorage.setItem('aibo.appearance.v1', JSON.stringify({ kitId: 'ak-ui', themeId: 'dark' })));
  await page.reload();
  await page.getByRole('button', { name: /^打开工作台设置/ }).waitFor();
  await page.waitForFunction(() => document.querySelector('.app-shell')?.dataset.uiKit === 'material3');
  assert.deepEqual(await appearance(), ['material3', 'light']);
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('aibo.appearance.v1'))), { kitId: 'material3', themeId: 'light' });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, nativePort: 'mocked; actual App.svelte', checks: [
    'first start commits the cached kit against its built-in release',
    'kit switch and brightness toggle commit to the release store',
    'built-ins are listed through kits and absent from package management',
    'committed selection overrides a stale first-paint cache after restart',
  ] }));
} finally {
  await browser.close();
  await server.close();
}
