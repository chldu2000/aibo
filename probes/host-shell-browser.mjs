import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const server = await createServer({server: {host: '127.0.0.1', port: 0, hmr: false, watch: null}});
await server.listen();
const browser = await chromium.launch({headless: true});
try {
  const page = await browser.newPage({viewport: {width: 1280, height: 900}});
  page.setDefaultTimeout(10000);
  const errors = [];
  const runCommand = async label => {
    await page.keyboard.press('Control+k');
    await page.locator('#global-search-input').fill(label);
    await page.getByRole('option').filter({hasText:label}).click();
  };
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  for (const kit of ['shadcn', 'material3']) {
    await page.evaluate(async kit => (await import('/src/lib/ui-kit/registry.ts')).setUiKit(kit), kit);
    await page.locator('[data-presentation-layout="standard"]:not([inert])').waitFor();
    const titlebar = page.getByRole('toolbar', {name:'窗口标题栏'});
    assert.equal(await titlebar.getByRole('button', {name:/执行历史|会话历史/}).count(), 0);
    assert.equal(await page.locator('.presentation-controls').count(), 0);
    assert.equal(await page.getByRole('button', {name:'恢复默认呈现', exact:true}).count(), 0);
    assert.equal(await page.locator('[data-ui-component="workspace-sidebar"]').getByRole('button', {name:'会话历史',exact:true}).count(), 0);
    const focus = page.locator('.timeline-heading-actions').getByRole('button', {name:'专注会话',exact:true});
    assert.equal((await focus.innerText()).trim(), '', 'focus is an icon button');
    await focus.click();
    await page.locator('[data-presentation-layout="focus"]:not([inert])').waitFor();
    assert.equal(await focus.getAttribute('aria-pressed'), 'true');
    await focus.click();
    await page.locator('[data-presentation-layout="standard"]:not([inert])').waitFor();
    await page.getByRole('button', {name:'打开设置',exact:true}).click();
    await page.getByRole('dialog', {name:'外观设置'}).getByRole('button', {name:'恢复默认呈现',exact:true}).click();
    await page.locator('[data-presentation-layout="standard"][inert]').waitFor();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.getByRole('dialog', {name:'外观设置'}).evaluate(node => node.contains(document.activeElement)), true, 'layout recovery must not steal focus from settings');
    await page.getByRole('button', {name:'关闭设置',exact:true}).click();
    await page.screenshot({path:`/tmp/aibo-entries-${kit}.png`});
    await page.getByRole('button', {name: '插件', exact: true}).click();
    const panel = page.getByRole('region', {name: '插件工作台'});
    try { await panel.waitFor(); } catch (error) {
      console.error(JSON.stringify({ kit, errors, text: await page.locator('body').innerText(), panels: await page.locator('.host-plugin-region').count() }));
      await page.screenshot({ path: '/tmp/aibo-history-browser-failure.png' }); throw error;
    }
    await page.evaluate(() => { window.savedHostPanel = document.querySelector('.host-plugin-region'); });
    await runCommand('切换专注会话');
    await page.waitForFunction(() => document.querySelector('[data-presentation-layout="focus"][aria-busy="false"]'));
    await runCommand('恢复默认呈现');
    await page.waitForFunction(() => document.querySelector('[data-presentation-layout="standard"][aria-busy="false"]'));
    assert.equal(await page.evaluate(() => window.savedHostPanel === document.querySelector('.host-plugin-region')), true);
    await page.getByRole('button', {name: '关闭插件工作台', exact: true}).click();
    await panel.waitFor({state: 'detached'});
    await page.locator('.workspace-grid').waitFor();
    const historyButton = page.getByRole('button', { name: '执行历史', exact: true });
    await page.getByRole('button',{name:'打开 Agent 诊断',exact:true}).click();
    await historyButton.click();
    const history = page.getByRole('region', { name: '执行历史', exact: true });
    await history.waitFor();
    await page.keyboard.press('Control+k');
    await page.locator('#global-search-input').waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await history.isVisible(), true, 'closing the palette must not close history');
    assert.equal(await page.locator('.host-panel-header h2').evaluate(node => document.activeElement === node), true);
    await page.evaluate(() => { window.savedHistory = document.querySelector('.host-history-region'); });
    await runCommand('切换专注会话');
    await page.waitForFunction(() => document.querySelector('[data-presentation-layout="focus"][aria-busy="false"]'));
    await page.keyboard.press('Control+Shift+Backspace');
    await page.waitForFunction(() => document.querySelector('[data-presentation-layout="standard"][aria-busy="false"]'));
    assert.equal(await page.evaluate(() => window.savedHistory === document.querySelector('.host-history-region')), true);
    await page.screenshot({ path: `/tmp/aibo-history-${kit}.png` });
    await page.getByRole('button',{name:'插件调用历史',exact:true}).click();
    const audit=page.getByRole('region',{name:'插件调用历史',exact:true});await audit.waitFor();
    assert.equal(await page.locator('.host-panel-header h2').evaluate(node=>document.activeElement===node),true);
    await page.getByRole('button',{name:'← 执行历史',exact:true}).click();await history.waitFor();
    await page.keyboard.press('Escape'); await history.waitFor({state: 'detached'});
    assert.equal(await page.getByRole('button',{name:'打开 Agent 诊断',exact:true}).evaluate(node => document.activeElement === node), true);
    await runCommand('会话历史');
    const sessionHistory = page.getByRole('region',{name:'会话历史',exact:true}); await sessionHistory.waitFor();
    assert.equal(await page.locator('#session-history-heading').evaluate(node=>document.activeElement===node),true);
    await page.evaluate(()=>{window.savedSessionHistory=document.querySelector('.host-session-history-region');});
    await runCommand('切换专注会话');
    await page.waitForFunction(()=>document.querySelector('[data-presentation-layout="focus"][aria-busy="false"]'));
    await page.keyboard.press('Control+Shift+Backspace');
    await page.waitForFunction(()=>document.querySelector('[data-presentation-layout="standard"][aria-busy="false"]'));
    assert.equal(await page.evaluate(()=>window.savedSessionHistory===document.querySelector('.host-session-history-region')),true);
    await page.keyboard.press('Escape'); await sessionHistory.waitFor({state:'detached'});
    assert.equal(await page.getByRole('button',{name:'打开设置',exact:true}).evaluate(node=>document.activeElement===node),true);


  }
  assert.deepEqual(errors, []);
  console.log('Actual App host controls , plugin management, and execution history remain clickable across layouts in both skins');
} finally { await browser.close(); await server.close(); }
