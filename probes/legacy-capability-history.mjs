import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false,watch:null}});await server.listen();
const browser=await chromium.launch({headless:true}),results=[];
try{
 for(const kit of ['shadcn','material3']){
  const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/probes/legacy-capability-history.html`);
  await page.waitForFunction(()=>window.legacyHistoryProbe);await page.evaluate(kit=>window.legacyHistoryProbe.kit(kit),kit);
  await page.getByRole('button',{name:'旧调用快照',exact:true}).click();
  await page.getByRole('article',{name:'调用记录 55',exact:true}).waitFor();
  assert.equal(await page.getByRole('article').count(),50);
  assert.ok((await page.locator('body').textContent()).includes('无法还原完整生命周期'));
  await page.getByRole('button',{name:'更早记录',exact:true}).click();
  await page.getByRole('article',{name:'调用记录 1',exact:true}).waitFor();assert.equal(await page.getByRole('article').count(),5);
  assert.equal(await page.getByRole('button',{name:'更早记录',exact:true}).isDisabled(),true);
  await page.getByRole('button',{name:'较新记录',exact:true}).click();await page.getByRole('article',{name:'调用记录 55',exact:true}).waitFor();
  await page.getByRole('button',{name:'生命周期记录',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('article').length===0);
  assert.deepEqual(await page.evaluate(()=>window.legacyHistoryProbe.reads().map(read=>read.source)),['legacy','legacy','legacy']);
  assert.deepEqual(errors,[]);results.push({kit,legacySource:true,explanation:true,pagination:true,returnToEvents:true});await page.close();
 }
 await writeFile('/tmp/aibo-p4-legacy-capability-history.json',JSON.stringify({results},null,2)+'\n');console.log(JSON.stringify({results}));
}finally{await browser.close();await server.close();}
