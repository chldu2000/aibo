import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { buildPresentationSkins } from './lib/build-presentation-skins.mjs';

const built = await buildPresentationSkins();
const server = await createServer({ cacheDir: '/tmp/aibo-lifecycle-browser-vite',
  server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
  plugins: [{ name: 'lifecycle-observation', enforce: 'pre', transform(code, id) {
    if (!id.endsWith('/src/App.svelte')) return;
    return code.replace('</script>', `
      if (typeof window !== 'undefined') (window as any).lifecycleState = () => ({
        selected: selectedSessionId, timeline: timeline.map(item => item.content),
      });
    </script>`);
  } }],
});
await server.listen();
const browser = await chromium.launch({ headless: true });
try {
  for (const [theme, pkg] of [['light', null], ['dark', null], ['light', built.packages[0]], ['dark', built.packages[1]]]) {
    for (const operation of ['fork', 'unarchive']) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      page.setDefaultTimeout(15000);
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(({ theme, pkg, operation }) => {
        if (window !== window.top) return;
        localStorage.setItem('aibo.appearance.v1', JSON.stringify({ kitId: 'ak-ui', themeId: theme }));
        const workspace = { id: 'w', label: '导航测试', path: '/probe', trust: 'trusted', createdAt: '2026-09-25', updatedAt: '2026-09-25' };
        const session = { id: 'a', workspaceId: 'w', label: '会话 A', agent: 'external.agent', pluginInstallationId: 'fixture',
          state: 'idle', archived: false, externalSessionId: 'native', capabilities: ['session.fork'], createdAt: '2026-09-25', updatedAt: '2026-09-25' };
        const sessions = [session, { ...session, id: 'b', label: '会话 B' }, { ...session, id: 'archived', label: '归档会话', archived: true }];
        const resultId = operation === 'fork' ? 'forked' : 'archived';
        const message = id => ({ id: `message-${id}`, sessionId: id, turnId: null, role: 'assistant', toolName: null,
          content: `正文 ${id}`, status: 'completed', createdAt: '2026-09-25', updatedAt: '2026-09-25' });
        let callback = 0;
        window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
          transformCallback(fn) { const id = ++callback; window['_' + id] = fn; return id; }, unregisterCallback(id) { delete window['_' + id]; },
          async invoke(command, args = {}) {
            if (command.startsWith('plugin:event|')) return 1;
            if (command === 'get_app_snapshot') return { platform: 'macos', appVersion: 'probe', workspaceCount: 1, diagnostics: [] };
            if (command === 'list_workspaces') return [workspace];
            if (command === 'list_sessions') return sessions.map(value => ({ ...value }));
            if (command === 'get_presentation_selection') return pkg ? { digest: pkg.release.digest, themeId: null } : null;
            if (command === 'list_presentation_packages') return pkg ? [pkg.release] : [];
            if (command === 'read_presentation_package') return pkg;
            if (command === 'fork_codex_thread') { const forked = { ...session, id: resultId, label: '分支结果' }; sessions.push(forked); return forked; }
            if (command === 'unarchive_session') { const restored = sessions.find(value => value.id === args.sessionId); restored.archived = false; return { ...restored }; }
            if (command === 'get_timeline') {
              if (args.sessionId === resultId) return new Promise(resolve => { window.releaseLifecycleRead = () => resolve([message(resultId)]); });
              return [message(args.sessionId)];
            }
            if (command === 'get_composer_draft' || command === 'get_turn_change_set') return null;
            if (command === 'get_session_execution_profile') return { sessionId: args.sessionId, requested: {}, enforced: {}, unsupported: [], adapterCapabilities: [], sessionControls: [] };
            if (command === 'get_workspace_changes') return { workspaceId: 'w', dirty: false, files: [], captureStatus: 'captured' };
            if (command === 'list_workspace_git_repositories') return { repositories: [], limited: false, warnings: [] };
            if (command === 'inspect_workspace_capabilities') return { workspaceId: 'w', instructions: [], skills: [], tools: [], mcpServers: [], warnings: [] };
            if (command === 'read_workspace_preferences') return { trustNewWorkspaces: true };
            return [];
          },
        };
      }, { theme, pkg, operation });
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
      const view = pkg ? page.frameLocator('.presentation-external iframe:visible') : page;
      if (pkg) await page.locator('.presentation-external iframe:visible').waitFor();
      await view.getByText('会话 A', { exact: true }).first().click();
      await page.waitForFunction(() => window.lifecycleState().selected === 'a');
      if (operation === 'fork') await view.getByRole('button', { name: pkg ? '分叉会话' : '分支', exact: true }).click();
      else {
        if (!pkg) {
          const more = view.getByRole('button', { name: '归档会话 更多操作', exact: true });
          await more.focus(); await more.press('Enter');
        }
        await view.getByRole('button', { name: '取消归档', exact: true }).click();
      }
      await page.waitForFunction(() => typeof window.releaseLifecycleRead === 'function');
      await view.getByText('会话 B', { exact: true }).first().click();
      await page.waitForFunction(() => window.lifecycleState().timeline.includes('正文 b'));
      await page.evaluate(() => window.releaseLifecycleRead());
      await page.waitForTimeout(150);
      assert.deepEqual(await page.evaluate(() => window.lifecycleState()), { selected: 'b', timeline: ['正文 b'] });
      await view.getByText('正文 b', { exact: true }).waitFor();
      assert.deepEqual(errors, []);
      await page.close();
      console.log(`${theme} ${pkg?.release.manifest.displayName ?? 'ak-ui'} ${operation}: real action/navigation and stale timeline isolation passed`);
    }
  }
} finally { await browser.close(); await server.close(); await built.dispose(); }
