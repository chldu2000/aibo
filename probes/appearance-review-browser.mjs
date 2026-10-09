import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createBuiltinWorkbenchServer } from './lib/builtin-workbench-fixture.mjs';

const output = '/tmp/aibo-appearance-review';
await mkdir(output, {recursive:true});
const server = await createBuiltinWorkbenchServer({plugins:[{
  name:'appearance-review-selection', enforce:'pre', transform(code,id) {
    if (!id.endsWith('/src/App.svelte')) return;
    return code.replace("setTimeout(()=>{selectedSessionId='a';sidePanelView='context';},100);",
      "setTimeout(()=>{selectedSessionId='a';sidePanelView='context';},100); window.clearReviewSession=()=>{selectedSessionId=null;timeline=[];};");
  },
}]});
await server.listen();
const browser = await chromium.launch({headless:true});
try {
  for (const kit of ['material3','ak-ui']) for (const theme of ['light','dark']) {
    const page = await browser.newPage({locale:'zh-CN',viewport:{width:1440,height:960},reducedMotion:'reduce'});
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.setDefaultTimeout(10000);
    await page.addInitScript(({kit,theme})=>localStorage.setItem('aibo.appearance.v1',JSON.stringify({kitId:kit,themeId:theme})),{kit,theme});
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
    await page.getByRole('tab',{name:'对话',exact:true}).waitFor();
    await page.getByRole('button',{name:'全局搜索',exact:true}).click();
    const search=page.getByRole('dialog',{name:'全局搜索',exact:true});
    const input=search.getByRole('combobox',{name:'全局搜索内容'});
    await input.fill('归档会话');
    const command=search.getByRole('option').filter({hasText:'/archive'});
    await command.waitFor();
    assert.equal(await command.locator('strong').innerText(),'归档会话');
    assert.ok(!(await command.innerText()).includes('填入输入框'));
    await command.click();
    assert.equal(await page.locator('[data-composer-input]').inputValue(),'/archive ');
    await page.getByRole('button',{name:'全局搜索',exact:true}).click();
    await input.fill('');
    for (const width of [1440,760,480]) {
      await page.setViewportSize({width,height:960});
      const layout=await search.evaluate(el=>{
        const categories=el.querySelector('.global-search-categories').getBoundingClientRect();
        const scope=el.querySelector('.global-search-scope').getBoundingClientRect();
        return {fits:el.scrollWidth<=el.clientWidth,aligned:Math.abs(scope.left-categories.left)<1,separate:scope.top>=categories.bottom};
      });
      assert.deepEqual(layout,{fits:true,aligned:true,separate:true});
      await page.screenshot({path:`${output}/${kit}-${theme}-search-${width}.png`});
    }
    await page.keyboard.press('Escape');
    await page.setViewportSize({width:760,height:960});
    await page.screenshot({path:`${output}/${kit}-${theme}-navigation.png`});
    await page.getByRole('tab',{name:'执行记录',exact:true}).click();
    await page.evaluate(()=>window.clearReviewSession());
    assert.equal(await page.locator('.conversation-navigation').count(),0);
    await page.getByRole('heading',{name:'选择或新建会话',exact:true}).waitFor();
    assert.equal(await page.locator('.timeline-heading-copy small').count(),0);
    await page.getByRole('button',{name:'打开工作台设置',exact:true}).click();
    const settings=page.getByRole('dialog',{name:'工作台设置',exact:true});
    for (const section of ['布局','工作区','插件与能力','运行与诊断']) {
      await settings.getByRole('tab',{name:section,exact:true}).click();
      assert.ok(await settings.locator('.management-content').evaluate(el=>el.scrollWidth<=el.clientWidth));
      await page.screenshot({path:`${output}/${kit}-${theme}-${section}.png`});
    }
    await settings.getByRole('status').filter({hasText:'浏览器预览无法检测本机 Agent'}).waitFor();
    assert.equal(await settings.getByText('2/2 就绪',{exact:true}).count(),0);
    assert.deepEqual(errors,[]);
    await page.close();
    console.log(`${kit}/${theme}: command labels/insertion, search layout, empty session and preview diagnostics passed`);
  }
} finally { await browser.close(); await server.close(); }
