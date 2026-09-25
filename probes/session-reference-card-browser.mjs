import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const server=await createServer({server:{host:'127.0.0.1',port:0,strictPort:false,watch:null}});await server.listen();
const browser=await chromium.launch({headless:true});
try {
 for(const kit of ['ak-ui','material3']) {
  const page=await browser.newPage();page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/probes/session-reference-card.html`);
  await page.evaluate(async kit=>{(await import('/src/lib/ui-kit/registry.ts')).setUiKit(kit);document.body.dataset.uiKit=kit;},kit);
  const summary=page.locator('summary').filter({hasText:'引用会话 · 设计讨论'});await summary.waitFor();
  const details=page.locator('details').filter({has:summary});
  assert.equal(await details.evaluate(el=>el.open),false);assert.equal(await page.getByText('精简后的设计结论',{exact:true}).isVisible(),false);
  await summary.click();assert.equal(await page.getByText('精简后的设计结论',{exact:true}).isVisible(),true);
  const body=await page.locator('body').innerText();assert.ok(!body.includes('AIBO_SESSION_REFERENCES'));assert.ok(!body.includes('SECRET_TOOL_BODY'));assert.ok(body.includes('这个会话内容是什么'));
  await summary.focus();await page.keyboard.press('Enter');assert.equal(await details.evaluate(el=>el.open),false);
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/probes/session-reference-card.html?full`);
  await page.evaluate(async kit=>{(await import('/src/lib/ui-kit/registry.ts')).setUiKit(kit);document.body.dataset.uiKit=kit;},kit);
  await summary.click();
  assert.match(await details.innerText(), /完整正文末尾/);
  assert.match(await details.innerText(), /第 18 条消息/);
  assert.match(await details.innerText(), /全部用户 \/ Agent 消息/);
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log('Both skins: references collapsed by default, readable expansion, keyboard collapse, no raw transport or tool body');
}finally{await browser.close();await server.close();}
