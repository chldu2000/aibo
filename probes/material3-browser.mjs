import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createBuiltinWorkbenchServer } from './lib/builtin-workbench-fixture.mjs';

const server = await createBuiltinWorkbenchServer();
await server.listen();
const browser = await chromium.launch({headless:true});
const output = process.env.AIBO_PROBE_OUTPUT ?? '/tmp/aibo-material3';
await mkdir(output, {recursive:true});
const page = await browser.newPage({viewport:{width:1440,height:960}});
page.setDefaultTimeout(10000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const input = page.locator('[data-composer-input]');
const settings = page.getByRole('dialog', {name:'工作台设置', exact:true});
const openSettings = () => page.getByRole('button', {name:/^打开工作台设置/}).click();
const selectKit = async kit => {
  await settings.locator('.appearance-kit-option').filter({hasText:kit === 'material3' ? 'Aibo · Material 3' : 'Aibo · ak-ui'}).click();
  await page.waitForFunction(kit => document.querySelector('.app-shell')?.dataset.uiKit === kit, kit);
};
try {
  await page.addInitScript(() => {
    if (!localStorage.getItem('aibo.appearance.v1')) localStorage.setItem('aibo.appearance.v1', JSON.stringify({kitId:'ak-ui',themeId:'light'}));
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
  await page.locator('.assistant-entry').waitFor();
  await input.fill('切换外观仍保留 @pnpm-lock.yaml 和草稿');
  await input.evaluate(el => {el.setSelectionRange(4,8);window.originalEditor=el;});
  await page.locator('.tool-output > summary').first().click();
  const messages = await page.locator('.timeline-feed-content').innerText();
  const attachmentCount = await page.locator('.composer .attachment-item').count();
  await openSettings();
  await settings.evaluate(el => window.originalManagement=el);
  assert.equal(await settings.locator('.appearance-kit-option').count(),2);
  await selectKit('material3');
  assert.equal(await page.evaluate(() => window.originalEditor === document.querySelector('[data-composer-input]')),true,'editor identity survives skin selection');
  assert.equal(await settings.evaluate(el => window.originalManagement===el),true,'the settings dialog stays mounted');
  await page.getByRole('button',{name:'关闭设置',exact:true}).click();
  assert.equal(await input.inputValue(),'切换外观仍保留 @pnpm-lock.yaml 和草稿');
  assert.equal(await page.locator('.composer .attachment-item').count(),attachmentCount);
  assert.equal(await page.locator('.timeline-feed-content').innerText(),messages);
  assert.equal(await page.locator('.tool-output').first().getAttribute('open'),'');
  assert.deepEqual(await input.evaluate(el=>[el.selectionStart,el.selectionEnd]),[4,8]);
  for (const theme of ['light','dark']) {
    if(await page.locator('.app-shell').getAttribute('data-ui-theme')!==theme) await page.getByRole('button',{name:'切换明暗主题',exact:true}).click();
    assert.equal(await page.locator('.composer').evaluate(el=>getComputedStyle(el).borderRadius),'24px');
    assert.equal(await page.locator('.sidebar-new-session').evaluate(el=>getComputedStyle(el).clipPath),'none');
    assert.equal(await page.locator('.sidebar-new-session').evaluate(el=>getComputedStyle(el).backgroundColor),theme==='light'?'rgb(215, 231, 255)':'rgb(36, 71, 117)','tonal action uses the design palette immediately');
    assert.equal(await page.locator('.session-item-row.selected').evaluate(el=>getComputedStyle(el).boxShadow),'none');
    assert.equal(await page.locator('.window-titlebar').evaluate(el=>el.getBoundingClientRect().height),32);
    await input.fill('请看 @pnpm-lock.yaml 然后\n继续检查组件外观');
    const metrics = await page.locator('.composer-textarea,.composer-mention-layer').evaluateAll(nodes => nodes.map(el=>{const s=getComputedStyle(el);return [s.padding,s.fontSize,s.lineHeight,s.fontFamily].join('|');}));
    assert.equal(new Set(metrics).size,1,'mention layer aligns with actual text');
    await page.screenshot({path:`${output}/${theme}-workbench.png`});
    await openSettings();
    await page.screenshot({path:`${output}/${theme}-settings.png`});
    for(const name of ['布局','工作区','插件与能力','运行与诊断','外观']) {
      await settings.getByRole('tab',{name,exact:true}).click();
      assert.equal(await settings.getByRole('tab',{name,exact:true}).getAttribute('aria-selected'),'true');
    }
    await selectKit('ak-ui');
    assert.equal(await page.locator('.app-shell').getAttribute('data-ui-theme'),theme,'brightness survives kit switches');
    await selectKit('material3');
    await page.keyboard.press('Escape');
  }
  await page.getByRole('button',{name:'新建会话',exact:true}).click();
  await page.getByRole('group',{name:'选择 Agent 创建会话'}).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('button',{name:'新建会话',exact:true}).evaluate(el=>document.activeElement===el),true);
  await page.getByRole('button',{name:'专注会话',exact:true}).click();
  await page.locator('[data-presentation-layout="focus"][aria-busy="false"]').waitFor();
  assert.match(await input.inputValue(),/继续检查/);
  await page.keyboard.press('Control+Shift+Backspace');
  await page.locator('[data-presentation-layout="standard"][aria-busy="false"]').waitFor();
  await page.reload();
  await page.locator('.assistant-entry').waitFor();
  assert.equal(await page.locator('.app-shell').getAttribute('data-ui-kit'),'material3');
  assert.equal(await page.locator('.app-shell').getAttribute('data-ui-theme'),'dark');
  for(const width of [1024,760,390]) {
    await page.setViewportSize({width,height:820});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await openSettings();
    assert.equal(await settings.evaluate(el=>el.scrollWidth<=el.clientWidth),true);
    await page.screenshot({path:`${output}/dark-settings-${width}.png`});
    await page.keyboard.press('Escape');
  }
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.ok(await page.locator('.sidebar-new-session').evaluate(el=>getComputedStyle(el).transitionDuration.split(',').every(duration=>parseFloat(duration)<=.00001)),'shared reduced-motion policy allows only its near-zero completion duration');
  assert.deepEqual(errors,[]);
  console.log(`Material 3 passed: both themes, live kit switch, stable editors/dialogs, draft/selection/attachments/history, mentions, chooser focus, layouts, persistence, narrow windows, reduced motion. Screenshots: ${output}`);
} catch(error) {
  await page.screenshot({path:`${output}/failure.png`});
  throw error;
} finally { await browser.close(); await server.close(); }
