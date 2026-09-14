import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright';
const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false,watch:null}});
await server.listen();
const browser=await chromium.launch({headless:true});
try {
  for(const [kit,theme] of [['shadcn','light'],['material3','daylight'],['shadcn','zinc'],['material3','ocean']]) {
    const page=await browser.newPage({viewport:{width:1280,height:900}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
    await page.addInitScript(({kit,theme})=>{if(window===window.top)localStorage.setItem('aibo.appearance.v1',JSON.stringify({kitId:kit,themeId:theme}));},{kit,theme});
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
    await page.getByRole('button',{name:'打开设置',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'外观设置',exact:true});
    for(const title of ['工作台布局','皮肤插件']) {
      const group=dialog.getByRole('region',{name:title,exact:true});await group.waitFor();
      const box=await group.boundingBox(), parent=await dialog.boundingBox();
      assert.ok(box.x>=parent.x+16 && box.x+box.width<=parent.x+parent.width-16, 'settings respect panel gutters');
      for(const button of await group.getByRole('button').all())assert.ok((await button.boundingBox()).width<box.width*0.75,'actions must not fill the group');
    }
    await dialog.getByRole('button',{name:'交换工作台侧边区域',exact:true}).click();
    await page.locator('[data-presentation-layout="review"][aria-busy="false"]').waitFor();
    assert.match(await dialog.getByRole('button',{name:'交换工作台侧边区域',exact:true}).innerText(),/导航移到左侧/);
    await dialog.getByRole('button',{name:'恢复默认呈现',exact:true}).click();
    await page.locator('[data-presentation-layout="standard"][aria-busy="false"]').waitFor();
    await page.screenshot({path:`/tmp/aibo-settings-${kit}-${theme}.png`});
    await page.setViewportSize({width:480,height:820});
    assert.equal(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth),true);
    for(const group of await dialog.locator('[data-ui-component="settings-section"]').all())assert.equal(await group.evaluate(el=>el.scrollWidth<=el.clientWidth),true);
    await page.screenshot({path:`/tmp/aibo-settings-narrow-${kit}-${theme}.png`});
    await dialog.getByRole('button',{name:'关闭设置',exact:true}).click();
    await page.setViewportSize({width:1280,height:900});
    await page.getByRole('button',{name:'打开 Agent 诊断',exact:true}).click();
    const history=page.getByRole('region',{name:'执行记录',exact:true});await history.waitFor();
    const box=await history.boundingBox();
    const action=history.getByRole('button',{name:'执行历史',exact:true});
    assert.ok((await action.boundingBox()).width<box.width/2);
    await page.screenshot({path:`/tmp/aibo-diagnostics-${kit}-${theme}.png`});
    await action.click();
    await page.getByRole('button',{name:'← 诊断',exact:true}).click();
    await history.waitFor();
    assert.deepEqual(errors,[]);
    await page.close();
    console.log(`${kit}/${theme}: settings spacing, compact actions, narrow layout and navigation passed`);
  }
} finally {await browser.close();await server.close();}
