import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false,watch:null}});await server.listen();
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/probes/presentation-sandbox.html`);
  await page.waitForFunction(()=>window.sandboxProbe);
  await page.evaluate(async()=>{window.sandboxProbe.echoDraft(true);await window.sandboxProbe.mount("self.aiboPresentation={render(input){return {tag:'textarea',key:'draft',attrs:{'aria-label':'Draft',value:input.data.draft||''},events:{input:'draft'}}}}",{draft:''});});
  const editor=page.frameLocator('iframe').getByRole('textbox',{name:'Draft'});
  await editor.pressSequentially('quick typing keeps every character',{delay:10});
  await page.waitForTimeout(200);
  const actual=await editor.inputValue();
  console.log(JSON.stringify({actual,accepted:await page.evaluate(()=>window.sandboxProbe.intents.map(i=>i.value))}));
  assert.equal(actual,'quick typing keeps every character');
} finally {await browser.close();await server.close();}
