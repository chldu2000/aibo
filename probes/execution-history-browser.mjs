import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const server = await createServer({server:{host:'127.0.0.1',port:0,watch:null}});
await server.listen(); const browser = await chromium.launch({headless:true});
try {
  for (const kit of ['shadcn','material3']) {
    const page = await browser.newPage(); const errors=[]; page.on('pageerror',error=>errors.push(String(error)));
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/probes/execution-history-browser.html`);
    await page.evaluate(async kit=>{ (await import('/src/lib/ui-kit/registry.ts')).setUiKit(kit); document.body.dataset.uiKit=kit; },kit);
    await page.waitForFunction(()=>document.querySelectorAll('article').length===20);
    await page.getByRole('button',{name:'更早一页',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('nav[aria-label="执行历史翻页"] [role="status"]')?.textContent==='第 2 页' && document.querySelectorAll('article').length===20);
    await page.getByRole('button',{name:'更早一页',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('article').length===2);
    assert.equal(await page.getByRole('button',{name:'更早一页',exact:true}).isDisabled(),true);
    await page.getByRole('button',{name:'较新一页',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('article').length===20);
    assert.equal(await page.getByRole('status').filter({hasText:'第 2 页'}).count(),1);
    await page.getByRole('button',{name:'Second workspace',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('nav[aria-label="执行历史翻页"] [role="status"]')?.textContent==='第 1 页');
    assert.equal(await page.getByRole('button',{name:'较新一页',exact:true}).isDisabled(),true);
    await page.getByRole('button',{name:'更早一页',exact:true}).click();
    await page.getByRole('button',{name:'最新记录',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('nav[aria-label="执行历史翻页"] [role="status"]')?.textContent==='第 1 页' && document.querySelectorAll('article').length===20);
    assert.deepEqual(errors,[]); await page.close();
  }
  console.log('Both skins browse all 42 mixed execution records, return to newer/latest pages, and reset on workspace changes');
} finally { await browser.close(); await server.close(); }
