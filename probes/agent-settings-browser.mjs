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
  for(const kit of ['ak-ui','material3']) {
    await page.evaluate(kit=>window.mountSettingsProbe(kit),kit);
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
    await page.screenshot({path:`/private/tmp/aibo-agent-settings-${kit}.png`,fullPage:true});
    await page.getByRole('button',{name:'重新加载并丢弃修改',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('[role="alert"]'));
    assert.equal(await page.getByLabel('名称',{exact:true}).inputValue(),'Default');
    await page.setViewportSize({width:960,height:900});
    console.log(`${kit}: all field types, save, reset, conflict preservation and narrow layout passed`);
  }
  assert.deepEqual(errors,[]);
} finally { await browser?.close();await server.close(); }
