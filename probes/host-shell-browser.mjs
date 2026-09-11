import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const server = await createServer({server: {host: '127.0.0.1', port: 0}});
await server.listen();
const browser = await chromium.launch({headless: true});
try {
  const page = await browser.newPage({viewport: {width: 1280, height: 900}});
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  for (const kit of ['shadcn', 'material3']) {
    await page.evaluate(async kit => (await import('/src/lib/ui-kit/registry.ts')).setUiKit(kit), kit);
    await page.getByRole('button', {name: '插件', exact: true}).click();
    const panel = page.getByRole('region', {name: '插件工作台'});
    try { await panel.waitFor(); } catch (error) {
      console.error(JSON.stringify({ kit, errors, text: await page.locator('body').innerText(), panels: await page.locator('.host-plugin-region').count() }));
      await page.screenshot({ path: '/tmp/aibo-history-browser-failure.png' }); throw error;
    }
    await page.evaluate(() => { window.savedHostPanel = document.querySelector('.host-plugin-region'); });
    await page.getByRole('button', {name: '切换工作台呈现', exact: true}).click();
    await page.waitForFunction(() => document.querySelector('[data-presentation-layout="focus"][aria-busy="false"]'));
    await page.getByRole('button', {name: '恢复默认呈现', exact: true}).click();
    await page.waitForFunction(() => document.querySelector('[data-presentation-layout="standard"][aria-busy="false"]'));
    assert.equal(await page.evaluate(() => window.savedHostPanel === document.querySelector('.host-plugin-region')), true);
    await page.getByRole('button', {name: '返回会话', exact: true}).click();
    await panel.waitFor({state: 'detached'});
    await page.locator('.workspace-grid').waitFor();
    const historyButton = page.getByRole('button', { name: '执行历史', exact: true });
    await historyButton.click();
    const history = page.getByRole('region', { name: '执行历史', exact: true });
    await history.waitFor();
    assert.equal(await page.locator('#execution-history-heading').evaluate(node => document.activeElement === node), true);
    await page.evaluate(() => { window.savedHistory = document.querySelector('.host-history-region'); });
    await page.getByRole('button', {name: '切换工作台呈现', exact: true}).click();
    await page.waitForFunction(() => document.querySelector('[data-presentation-layout="focus"][aria-busy="false"]'));
    await page.getByRole('button', {name: '恢复默认呈现', exact: true}).click();
    await page.waitForFunction(() => document.querySelector('[data-presentation-layout="standard"][aria-busy="false"]'));
    assert.equal(await page.evaluate(() => window.savedHistory === document.querySelector('.host-history-region')), true);
    await page.screenshot({ path: `/tmp/aibo-history-${kit}.png` });
    await page.keyboard.press('Escape'); await history.waitFor({state: 'detached'});
    assert.equal(await historyButton.evaluate(node => document.activeElement === node), true);
    const sessionHistoryButton = page.getByRole('button', {name:'会话历史',exact:true});
    await sessionHistoryButton.click();
    const sessionHistory = page.getByRole('region',{name:'会话历史',exact:true}); await sessionHistory.waitFor();
    assert.equal(await page.locator('#session-history-heading').evaluate(node=>document.activeElement===node),true);
    await page.evaluate(()=>{window.savedSessionHistory=document.querySelector('.host-session-history-region');});
    await page.getByRole('button',{name:'切换工作台呈现',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('[data-presentation-layout="focus"][aria-busy="false"]'));
    await page.getByRole('button',{name:'恢复默认呈现',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('[data-presentation-layout="standard"][aria-busy="false"]'));
    assert.equal(await page.evaluate(()=>window.savedSessionHistory===document.querySelector('.host-session-history-region')),true);
    await page.keyboard.press('Escape'); await sessionHistory.waitFor({state:'detached'});
    assert.equal(await sessionHistoryButton.evaluate(node=>document.activeElement===node),true);


  }
  assert.deepEqual(errors, []);
  console.log('Actual App host controls , plugin management, and execution history remain clickable across layouts in both skins');
} finally { await browser.close(); await server.close(); }
