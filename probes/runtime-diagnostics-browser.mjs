import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { buildPresentationSkins } from './lib/build-presentation-skins.mjs';
const skins = await buildPresentationSkins();
const server = await createServer({ server: { host: '127.0.0.1', port: 0, hmr: false, watch: null } });
await server.listen();
const browser = await chromium.launch({ headless: true });
try {
  const cases = ['material3', 'ak-ui'].flatMap(kit => ['light', 'dark'].map(theme => ({ kit, theme, pkg: null })));
  for (const pkg of skins.packages) cases.push({ kit: 'material3', theme: 'light', pkg });
  for (const config of cases) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.setDefaultTimeout(20000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ kit, theme, pkg }) => {
      if (window !== window.top) return;
      localStorage.setItem('aibo.appearance.v1', JSON.stringify({ kitId: kit, themeId: theme }));
      localStorage.setItem('aibo.language.v1', 'zh-CN');
      const provider = id => ({ id, kind: 'capabilityProvider', scope: 'session', metadata: { displayName: id, operations: [{ capability: { id: 'aibo.session.open' } }] } });
      const base = { pluginVersion: '1.0.0', installed: true, enabled: true, runnable: true, dependencies: [], contributions: [] };
      window.diagnosticPlugins = [
        { ...base, id: 'plain', pluginId: 'plain', manifest: { displayName: 'Plain' } },
        { ...base, id: 'third', pluginId: 'third', runnable: false, manifest: { displayName: 'Third party', authentication: { kind: 'cli-terminal', executable: 'third' } }, contributions: [provider('Agent A'), provider('Agent B')], dependencies: [{ name: 'Node', required: true, available: false, issue: '/long/path/'.repeat(18) + 'missing', kind: 'runtime', versionRange: '>=22' }] },
        { ...base, id: 'disabled', pluginId: 'disabled', enabled: false, runnable: false, manifest: { displayName: 'Disabled' } },
      ];
      window.diagnosticCalls = []; window.diagnosticFail = false;
      let callback = 0;
      window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } }, transformCallback(fn) { const id = ++callback; window['_' + id] = fn; return id; }, unregisterCallback(id) { delete window['_' + id]; }, async invoke(command, args = {}) {
        window.diagnosticCalls.push({ command, args });
        if (command.startsWith('plugin:event|')) return 1;
        if (command === 'get_app_snapshot') return { platform: 'macos', appVersion: 'probe', workspaceCount: 0, diagnostics: [{ agent: 'codex', status: 'missing', capabilities: [] }] };
        if (command === 'list_plugin_installations') { if (window.diagnosticFail) throw Error('offline fixture'); return structuredClone(window.diagnosticPlugins); }
        if (command === 'plugin_authentication_action') return 'authenticated';
        if (command === 'read_workspace_preferences') return { trustNewWorkspaces: true };
        if (command === 'read_host_confirmation_preferences') return { git: 'always-allow', projectAction: 'always-allow', turnRestore: 'always-allow', capabilityWrite: 'always-allow', viewWrite: 'always-allow' };
        if (command === 'get_presentation_selection') return pkg ? { digest: pkg.release.digest, themeId: pkg.release.manifest.themes[0].id } : null;
        if (command === 'list_presentation_packages') return pkg ? [pkg.release] : [];
        if (command === 'read_presentation_package') return pkg;
        if (command === 'get_node_runtime') return { selected: { path: '/node', version: '24.18.0', source: 'system' }, manualPath: null, hostRequirement: '>=22', downloadVersion: '24.18.0', downloadSupported: true, issues: [] };
        if (command === 'get_turn_change_set') return null;
        return [];
      } };
    }, config);
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
    if (config.pkg) await page.locator('.presentation-external iframe').first().waitFor();
    await page.locator('[data-host-navigation="management"]').click();
    const dialog = page.getByRole('dialog');
    const runtime = () => dialog.getByRole('tab', { name: '运行与诊断', exact: true }).click();
    await runtime();
    const panel = dialog.locator('[aria-labelledby="runtime-diagnostics-title"]');
    await panel.getByText('1 个插件需要处理', { exact: true }).waitFor();
    assert.equal(await panel.getByText('Disabled', { exact: true }).isVisible(), false);
    assert.equal(await panel.getByText('Plain', { exact: true }).isVisible(), false);
    assert.equal(await dialog.getByText('app-server', { exact: true }).count(), 0);
    assert.equal(await panel.getByRole('button', { name: '登录 / 授权', exact: true }).count(), 0);
    await panel.getByText('会话提供者：Agent A, Agent B', { exact: true }).waitFor();
    const shot = config.pkg ? config.pkg.release.digest.slice(0, 8) : `${config.kit}-${config.theme}`;
    await page.screenshot({ path: `/tmp/aibo-runtime-diagnostics-${shot}.png` });
    await page.setViewportSize({ width: 480, height: 820 });
    assert.equal(await dialog.locator('.management-content').evaluate(el => el.scrollWidth <= el.clientWidth), true);
    await panel.getByRole('button', { name: '管理插件：Third party', exact: true }).click();
    await dialog.getByRole('heading', { name: 'Third party', exact: true }).waitFor();
    assert.equal(await dialog.getByRole('tab', { name: '插件与能力', exact: true }).getAttribute('aria-selected'), 'true');
    // Repair the shared dependency source, then return: no second diagnostic state to repair.
    await page.evaluate(() => { window.diagnosticPlugins[1].runnable = true; window.diagnosticPlugins[1].dependencies = []; });
    await runtime();
    await panel.getByText('0 个插件需要处理', { exact: true }).waitFor();
    await panel.locator('summary').filter({ hasText: '其他插件' }).click();
    await panel.getByText('有未检查项', { exact: true }).waitFor();
    await panel.getByRole('button', { name: '管理插件：Third party', exact: true }).click();
    await dialog.getByRole('button', { name: '检查登录状态', exact: true }).click();
    await dialog.getByText(/CLI 报告已登录/).waitFor();
    await runtime();
    await panel.locator('summary').filter({ hasText: '其他插件' }).click();
    const row = panel.locator('.settings-row').filter({ has: page.getByText('Third party', { exact: true }) });
    await row.getByText('现有检查通过', { exact: true }).waitFor();
    await row.locator('summary').click();
    await row.getByText('最近一次登录检查通过。', { exact: true }).waitFor();
    await row.getByText(/登录检查时间：/).waitFor();
    assert.equal(await page.evaluate(() => window.diagnosticCalls.filter(call => call.command === 'plugin_authentication_action').length), 1, 'diagnostics do not initiate auth actions');
    await page.screenshot({ path: `/tmp/aibo-runtime-diagnostics-${shot}-narrow.png` });
    await page.evaluate(() => { window.diagnosticFail = true; });
    await dialog.getByRole('button', { name: '刷新诊断', exact: true }).click();
    await panel.getByRole('alert').filter({ hasText: 'offline fixture' }).waitFor();
    await row.getByText('Third party', { exact: true }).waitFor();
    await page.evaluate(() => { window.diagnosticFail = false; window.diagnosticPlugins = []; });
    await dialog.getByRole('button', { name: '刷新诊断', exact: true }).click();
    await panel.getByText('没有已安装的能力插件。', { exact: true }).waitFor();
    assert.equal(await panel.getByRole('alert').count(), 0);
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`${shot}: shared results, exact navigation, auth scope, failure recovery and empty state passed`);
  }
} finally { await browser.close(); await server.close(); }
