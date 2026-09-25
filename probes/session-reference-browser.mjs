import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const server=await createServer({server:{host:'127.0.0.1',port:0,strictPort:false,watch:null}});await server.listen();
const browser=await chromium.launch({headless:true});
try {
 for(const kit of ['ak-ui','material3']) {
  const page=await browser.newPage();page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',error=>{errors.push(String(error));console.error(String(error));});
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/probes/session-reference-browser.html`);
  await page.evaluate(async kit=>{(await import('/src/lib/ui-kit/registry.ts')).setUiKit(kit);document.body.dataset.uiKit=kit;},kit);
  const input=page.locator('[data-composer-input]');await input.focus();
  assert.equal(await page.getByRole('option').count(),2);
  await input.press('Enter');assert.equal(await page.locator('output').textContent(),'source');
  await input.fill('@');await input.press('Escape');assert.equal(await page.getByRole('listbox').count(),0);
  await input.fill('@r');await input.press('ArrowDown');await input.press('Enter');
  assert.equal(await page.locator('output').textContent(),'README.md');
  await input.fill('@');await page.getByRole('option').filter({hasText:'设计讨论'}).click();
  assert.equal(await page.locator('output').textContent(),'source');assert.deepEqual(errors,[]);await page.close();
 }
 console.log('Both skins: session and path suggestions, keyboard selection, Escape, and click verified');
} finally {await browser.close();await server.close();}
