import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const server=await createServer({server:{host:'127.0.0.1',port:0,watch:null}});await server.listen();const browser=await chromium.launch({headless:true});
try {
  for(const kit of ['shadcn','material3']) {
    const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(String(error)));
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/probes/session-history-browser.html`);
    await page.evaluate(async kit=>{(await import('/src/lib/ui-kit/registry.ts')).setUiKit(kit);document.body.dataset.uiKit=kit;},kit);
    await page.waitForFunction(()=>document.querySelectorAll('article').length===50);
    await page.getByRole('button',{name:'更早消息',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('textarea')?.value==='current 保存消息 21');
    await page.getByRole('button',{name:'更早消息',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('article').length===21);
    assert.equal(await page.getByRole('button',{name:'更早消息',exact:true}).isDisabled(),true);
    assert.equal(await page.locator('textarea').first().inputValue(),'current 保存消息 0');
    await page.getByRole('button',{name:'旧会话（已归档）',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('textarea')?.value==='old 保存消息 71');
    assert.equal(await page.getByRole('button',{name:'较新消息',exact:true}).isDisabled(),true);
    await page.getByRole('textbox',{name:'搜索历史会话',exact:true}).fill('旧');
    assert.equal(await page.getByRole('button',{name:'当前会话',exact:true}).count(),0);
    await page.getByRole('button',{name:'更早消息',exact:true}).click();
    await page.getByRole('button',{name:'最新消息',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('textarea')?.value==='old 保存消息 71');
    assert.deepEqual(errors,[]);await page.close();
  }
  console.log('Both skins browse all 121 persisted messages, switch to archived history, search sessions, and return to latest messages');
}finally{await browser.close();await server.close();}
