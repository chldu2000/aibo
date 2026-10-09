import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const server=await createServer({server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false,watch:null}});
await server.listen();
let browser;
try {
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:960,height:900}});
  const errors=[];page.on('pageerror',error=>errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/probes/agent-settings.html`);
  await page.waitForFunction(()=>Boolean(window.mountSettingsProbe));
  for(const kit of ['ak-ui','material3']) for(const theme of ['light','dark']) {
    await page.evaluate(({kit,theme})=>window.mountSettingsProbe(kit,theme),{kit,theme});
    await page.getByLabel('名称',{exact:true}).fill('Custom');
    await page.getByLabel('附加指令',{exact:true}).fill('Keep it brief.');
    await page.getByLabel('附带摘要',{exact:true}).uncheck();
    await page.getByLabel('结果数量',{exact:true}).fill('25');
    await page.getByRole('combobox',{name:'回答长度',exact:true}).click(); await page.getByRole('option').filter({hasText:'简短'}).click();
    await page.getByRole('button',{name:'保存设置',exact:true}).click();
    await page.getByRole('status').waitFor();
    assert.deepEqual(await page.evaluate(()=>window.settingsProbe.saves.at(-1).values),{text:'Custom',instructions:'Keep it brief.',enabled:false,limit:25,length:'brief'});
    await page.getByRole('button',{name:'全部使用继承值',exact:true}).click();
    assert.equal(await page.getByLabel('名称',{exact:true}).inputValue(),'Default');
    assert.equal(await page.getByLabel('附带摘要',{exact:true}).isChecked(),true);
    await page.getByRole('button',{name:'保存设置',exact:true}).click();
    await page.waitForFunction(()=>window.settingsProbe.saves.length===2);
    assert.deepEqual(await page.evaluate(()=>window.settingsProbe.saves.at(-1).values),{});
    await page.evaluate(()=>window.settingsProbe.fail=true);
    await page.getByLabel('名称',{exact:true}).fill('Unsaved');
    await page.getByRole('button',{name:'保存设置',exact:true}).click();
    await page.getByRole('alert').waitFor();
    assert.equal(await page.getByLabel('名称',{exact:true}).inputValue(),'Unsaved');
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:`/private/tmp/aibo-agent-settings-${kit}-${theme}.png`,fullPage:true});
    await page.getByRole('button',{name:'重新加载并丢弃修改',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('[role="alert"]'));
    assert.equal(await page.getByLabel('名称',{exact:true}).inputValue(),'Default');
    await page.evaluate(()=>window.settingsProbe.fail=false);
    for(const [key,zh,en] of [
      ['native.settings.concurrentChanged','配置已被其他窗口修改，请重新加载后再保存','Another window changed these settings. Reload them before saving.'],
      ['native.settings.versionChanged','设置版本已改变，请重新加载','The settings version changed. Reload settings.'],
      ['native.settings.valueInvalid','字段 text 的值不符合约束','The value of field text does not meet its constraints.'],
      ['native.settings.storageUnavailable','配置存储不可用','Configuration storage is unavailable.'],
    ]) {
      await page.evaluate(key=>window.settingsProbe.errorKey=key,key);
      await page.getByLabel('名称',{exact:true}).fill('原始草稿 {version}');await page.getByRole('button',{name:'保存设置',exact:true}).click();await page.getByRole('alert').filter({hasText:zh}).waitFor();
      const attempts=await page.evaluate(()=>window.settingsProbe.attempts);
      await page.evaluate(async()=>{const {language}=await import('/src/lib/i18n/runtime.ts');language.set({preference:'en',locale:'en'});});
      await page.getByRole('alert').filter({hasText:en}).waitFor();assert.equal(await page.getByLabel('名称',{exact:true}).inputValue(),'原始草稿 {version}');
      assert.equal(await page.evaluate(()=>window.settingsProbe.attempts),attempts);
      await page.getByRole('button',{name:'Save settings',exact:true}).waitFor();
      await page.evaluate(async()=>{const {language}=await import('/src/lib/i18n/runtime.ts');language.set({preference:'zh-CN',locale:'zh-CN'});});await page.getByRole('alert').filter({hasText:zh}).waitFor();
    }
    await page.setViewportSize({width:960,height:900});
    console.log(`${kit}/${theme}: field types, save, reset, bilingual native errors, preserved drafts and narrow layout passed`);
  }
  assert.deepEqual(errors,[]);
} finally { await browser?.close();await server.close(); }
