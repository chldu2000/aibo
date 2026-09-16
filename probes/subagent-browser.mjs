import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright';
const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false,watch:null}});
await server.listen();
const browser=await chromium.launch({headless:true});
const errors=[];
try {
 for(const skin of ['shadcn','material3']) {
  const page=await browser.newPage({viewport:{width:1280,height:800}});page.on('pageerror',error=>(errors.push(error.message), console.error(error.message)));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/probes/subagent-browser.html`);
  await page.getByRole('button',{name:skin,exact:true}).click();
  const card=page.getByRole('button',{name:'查看 Reader 的工作过程'});
  await card.click();
  const dialog=page.getByRole('dialog');await dialog.waitFor();
  assert.equal(await dialog.getByText('工作记录 1',{exact:true}).count(),1);
  const feed=page.locator('.subagent-feed');
  await feed.evaluate(element=>{element.scrollTop=120;element.dispatchEvent(new Event('scroll'));});
  await page.evaluate(()=>window.appendSubagentEntry());
  await page.getByRole('button',{name:'有新内容 · 查看最新'}).waitFor();
  assert.ok(Math.abs(await feed.evaluate(element=>element.scrollTop)-120)<2,'new content must preserve reading position');
  await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
  assert.equal(await card.evaluate(element=>element===document.activeElement),true,'close restores focus');
  await card.press('Enter');await dialog.waitFor();
  assert.ok(Math.abs(await feed.evaluate(element=>element.scrollTop)-120)<2,'reopening restores reading position');
  await page.getByRole('button',{name:'关闭工作过程'}).click();
  await page.setViewportSize({width:390,height:680});await card.click();await dialog.waitFor();
  const box=await dialog.boundingBox();assert.ok(box.width<=390 && box.height<=680,'dialog fits a small viewport');
  await page.screenshot({path:`/tmp/aibo-subagent-${skin}.png`});await page.close();
 }
 assert.deepEqual(errors,[]);console.log('Both skins: modal, live updates, scroll preservation, focus, Escape and small viewport passed.');
} finally {await browser.close();await server.close();}
