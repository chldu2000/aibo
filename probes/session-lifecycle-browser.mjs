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
  const cases=['material3','ak-ui'].flatMap(kitId=>['light','dark'].map(theme=>({kitId,theme,pkg:null})));
  for(const pkg of built.packages)cases.push({kitId:'material3',theme:'light',pkg});
  for (const {kitId,theme,pkg} of cases) {
    for (const operation of ['fork', 'unarchive']) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      page.setDefaultTimeout(15000);
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(({ kitId, theme, pkg, operation }) => {
        if (window !== window.top) return;
        localStorage.setItem('aibo.language.v1','zh-CN');
        localStorage.setItem('aibo.appearance.v1', JSON.stringify({ kitId, themeId: theme }));
        window.lifecycleCalls=[];window.lifecycleLocale='zh-CN';
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
            window.lifecycleCalls.push({command,args});
            if(command==='set_window_locale'){window.lifecycleLocale=args.locale;return args.locale;}
            if (command.startsWith('plugin:event|')) return 1;
            if (command === 'get_app_snapshot') return { platform: 'macos', appVersion: 'probe', workspaceCount: 1, diagnostics: [] };
            if (command === 'list_workspaces') return [workspace];
            if (command === 'list_sessions') return sessions.map(value => ({ ...value }));
            if (command === 'get_presentation_selection') return pkg ? { digest: pkg.release.digest, themeId: null } : null;
            if (command === 'list_presentation_packages') return pkg ? [pkg.release] : [];
            if (command === 'read_presentation_package') return pkg;
            if (command === 'fork_codex_thread') { const forked = { ...session, id: resultId, label:session.label+(window.lifecycleLocale==='en'?' · Branch':' · 分支') }; sessions.push(forked); return forked; }
            if (command === 'unarchive_session') { const restored = sessions.find(value => value.id === args.sessionId); restored.archived = false; return { ...restored }; }
            if (command === 'get_timeline') {
              if (args.sessionId === resultId) return new Promise(resolve => { window.releaseLifecycleRead = () => resolve([message(resultId),...(operation==='fork'?[{...message(resultId),id:'copied-notice',role:'system',content:'审批后切换到 模式原文 {label}',localizedContent:{schema:'aibo.host-message/v1',key:'native.session.controlChanged',params:{label:'模式原文 {label}'}}}]:[])]); });
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
      }, { kitId, theme, pkg, operation });
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
      const view = pkg ? page.frameLocator('.presentation-external iframe:visible') : page;
      if (pkg) await page.locator('.presentation-external iframe:visible').waitFor();
      await view.getByText('会话 A', { exact: true }).first().click();
      await page.waitForFunction(() => window.lifecycleState().selected === 'a');
      if (operation === 'fork') {
        await page.evaluate(async()=>{const {language}=await import('/src/lib/i18n/runtime.ts');language.set({preference:'en',locale:'en'});});
        await page.waitForFunction(()=>window.lifecycleLocale==='en');
        await view.getByRole('button', { name: pkg ? 'Fork session' : 'Branch', exact: true }).click();
      }
      else {
        if (!pkg) {
          const more = view.getByRole('button', { name: '归档会话 更多操作', exact: true });
          await more.focus(); await more.press('Enter');
        }
        await view.getByRole('button', { name: '取消归档', exact: true }).click();
      }
      await page.waitForFunction(() => typeof window.releaseLifecycleRead === 'function');
      if(operation==='fork'){
        for(const locale of ['zh-CN','en','zh-CN']){
          await page.evaluate(async locale=>{const {language}=await import('/src/lib/i18n/runtime.ts');language.set({preference:locale,locale});},locale);
          await view.getByText('会话 A · Branch',{exact:true}).first().waitFor();
          await view.getByText('会话 A',{exact:true}).first().waitFor();
          assert.equal(await page.evaluate(()=>window.lifecycleCalls.filter(call=>call.command==='fork_codex_thread').length),1);
        }
      }
      await view.getByText('会话 B', { exact: true }).first().click();
      await page.waitForFunction(() => window.lifecycleState().timeline.includes('正文 b'));
      await page.evaluate(() => window.releaseLifecycleRead());
      await page.waitForTimeout(150);
      assert.deepEqual(await page.evaluate(() => window.lifecycleState()), { selected: 'b', timeline: ['正文 b'] });
      await view.getByText('正文 b', { exact: true }).waitFor();
      if(operation==='fork'){
        await page.evaluate(()=>window.releaseLifecycleRead=null);
        await view.getByText('会话 A · Branch',{exact:true}).first().click();
        await page.waitForFunction(()=>typeof window.releaseLifecycleRead==='function');
        await page.evaluate(()=>window.releaseLifecycleRead());
        await view.getByText('正文 forked',{exact:true}).waitFor();
        const snapshot=await page.evaluate(()=>window.lifecycleState());
        const reads=await page.evaluate(()=>window.lifecycleCalls.filter(call=>call.command==='get_timeline').length);
        for(const locale of ['zh-CN','en','zh-CN']){
          await page.evaluate(async locale=>{const {language}=await import('/src/lib/i18n/runtime.ts');language.set({preference:locale,locale});},locale);
          await view.getByText(locale==='en'?'Switched to 模式原文 {label} after approval':'审批后切换到 模式原文 {label}',{exact:true}).waitFor();
          await view.getByText('会话 A · Branch',{exact:true}).first().waitFor();
          assert.deepEqual(await page.evaluate(()=>window.lifecycleState()),snapshot);
          assert.equal(await page.evaluate(()=>window.lifecycleCalls.filter(call=>call.command==='get_timeline').length),reads);
        }
      }
      assert.deepEqual(errors, []);
      await page.close();
      console.log(`${kitId}/${theme} ${pkg?.release.manifest.displayName ?? 'builtin'} ${operation}: saved branch names, language switching, real action/navigation and stale timeline isolation passed`);
    }
  }
} finally { await browser.close(); await server.close(); await built.dispose(); }
