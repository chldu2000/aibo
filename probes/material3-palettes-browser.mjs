import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {createBuiltinWorkbenchServer} from './lib/builtin-workbench-fixture.mjs';

const metadata=JSON.parse(await readFile('src/lib/ui-kit/kits/material3/themes.json','utf8'));
const server=await createBuiltinWorkbenchServer();
await server.listen();
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:960}});
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
const output='/tmp/aibo-material3-palettes';
await mkdir(output,{recursive:true});
const settings=page.getByRole('dialog',{name:'工作台设置',exact:true});
const input=page.locator('[data-composer-input]');
const open=async()=>{
  await page.getByRole('button',{name:/^打开工作台设置/}).click();
  await settings.evaluate(element=>window.paletteSettings=element);
};
const themeId=()=>page.locator('.app-shell').getAttribute('data-ui-theme');
const rgb=hex=>`rgb(${hex.slice(1).match(/../g).map(value=>parseInt(value,16)).join(', ')})`;
try {
  await page.addInitScript(()=>{
    if(!localStorage.getItem('aibo.appearance.v1'))localStorage.setItem('aibo.appearance.v1',JSON.stringify({kitId:'material3',themeId:'light'}));
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
  await page.locator('.assistant-entry').waitFor();
  await input.fill('配色与明暗切换保留 @pnpm-lock.yaml 草稿');
  await input.evaluate(element=>{window.paletteEditor=element;element.setSelectionRange(2,5);});
  const attachmentCount=await page.locator('.composer .attachment-item').count();
  await open();
  assert.equal(await settings.getByRole('radiogroup',{name:'明暗模式'}).getByRole('radio').count(),2);
  assert.equal(await settings.getByRole('radiogroup',{name:'配色方案'}).getByRole('radio').count(),3);
  for(const palette of ['blue','forest','plum']) {
    const pair=metadata.themes.filter(theme=>theme.palette.id===palette);
    await settings.getByRole('radio',{name:pair[0].palette.label,exact:true}).check();
    for(const theme of pair) {
      await settings.getByRole('radio',{name:theme.colorScheme==='light'?'浅色':'深色',exact:true}).check();
      assert.equal(await themeId(),theme.id);
      assert.equal(await input.evaluate(element=>element===window.paletteEditor),true);
      assert.equal(await settings.evaluate(element=>element===window.paletteSettings),true);
      const swatch=await settings.locator('.appearance-palette-option.active .appearance-palette-preview i').last().evaluate(element=>getComputedStyle(element).backgroundColor);
      assert.equal(swatch,rgb(theme.tokens['--md-sys-color-primary']));
      await page.screenshot({path:`${output}/${theme.id}-settings.png`});
      await page.keyboard.press('Escape');
      assert.equal(await input.inputValue(),'配色与明暗切换保留 @pnpm-lock.yaml 草稿');
      assert.deepEqual(await input.evaluate(element=>[element.selectionStart,element.selectionEnd]),[2,5]);
      assert.equal(await page.locator('.composer .attachment-item').count(),attachmentCount);
      const send=page.getByRole('button',{name:'发送',exact:true});
      assert.equal(await send.evaluate(element=>getComputedStyle(element).backgroundColor),rgb(theme.tokens['--md-sys-color-primary']));
      assert.equal(await page.locator('.timeline').evaluate(element=>getComputedStyle(element).backgroundColor),rgb(theme.tokens['--md-sys-color-surface']));
      assert.equal(await page.locator('.composer').evaluate(element=>getComputedStyle(element).borderRadius),'24px');
      await page.screenshot({path:`${output}/${theme.id}-workbench.png`});
      await page.getByRole('button',{name:'切换明暗主题',exact:true}).click();
      assert.equal(await themeId(),pair.find(candidate=>candidate.colorScheme!==theme.colorScheme).id);
      await page.getByRole('button',{name:'切换明暗主题',exact:true}).click();
      assert.equal(await themeId(),theme.id);
      await open();
    }
  }
  // Native radio keyboard navigation changes palette while preserving dark mode.
  await settings.getByRole('radio',{name:'经典蓝',exact:true}).check();
  await settings.getByRole('radio',{name:'森林绿',exact:true}).focus();
  await page.keyboard.press('ArrowRight');
  assert(await settings.getByRole('radio',{name:'紫罗兰',exact:true}).isChecked());
  assert.equal(await themeId(),'plum-dark');
  await page.keyboard.press('Escape');
  await page.reload();
  await page.locator('.assistant-entry').waitFor();
  assert.equal(await themeId(),'plum-dark');
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('aibo.appearance.v1'))),{kitId:'material3',themeId:'plum-dark'});
  await open();
  for(const width of [1024,760,390]) {
    await page.setViewportSize({width,height:820});
    assert.equal(await settings.evaluate(element=>element.scrollWidth<=element.clientWidth),true);
    await settings.getByRole('radio',{name:'森林绿',exact:true}).check();
    assert.equal(await themeId(),'forest-dark');
    await page.screenshot({path:`${output}/settings-${width}.png`});
  }
  await settings.locator('.appearance-kit-option').filter({hasText:'Aibo · ak-ui'}).click();
  assert.equal(await themeId(),'dark');
  assert.equal(await settings.getByRole('radiogroup',{name:'配色方案'}).count(),0);
  assert.equal(await settings.getByRole('radiogroup',{name:'主题',exact:true}).getByRole('radio').count(),2);
  await settings.getByRole('radio',{name:/浅色/}).check();
  assert.equal(await themeId(),'light');
  await page.keyboard.press('Escape');
  await page.setViewportSize({width:1440,height:960});
  assert.equal(await page.locator('.sidebar-new-session').evaluate(element=>getComputedStyle(element).backgroundColor),'rgb(255, 216, 2)');
  assert.deepEqual(errors,[]);
  console.log(`PASS: all three palettes in light/dark, independent mode/colour selection, titlebar pairing, radio keyboard navigation, stable editor/dialog/draft/selection/attachments, reload, narrow settings, unchanged ak-ui. Screenshots: ${output}`);
} catch(error) {
  await page.screenshot({path:`${output}/failure.png`});
  throw error;
} finally {await browser.close();await server.close();}
