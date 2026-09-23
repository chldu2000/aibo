import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {createServer} from 'vite';
import {chromium} from 'playwright';
const server=await createServer({server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false,watch:null},plugins:[{
  name:'ak-controls-fixture',configureServer(server){server.middlewares.use('/__ak-controls',(_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<html><meta name="viewport" content="width=device-width, initial-scale=1"><body><div id="app"></div><script type="module" src="/probes/fixtures/ak-ui-controls.mjs"></script></body></html>')})}
}]});
await server.listen();const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1100,height:1000}});const errors=[];
page.on('pageerror',e=>errors.push(e.message));await mkdir('/tmp/aibo-ak-controls',{recursive:true});
try {
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__ak-controls`);
 await page.getByRole('button',{name:'暂停目标',exact:true}).click();assert.equal(await page.getByLabel('操作结果').textContent(),'pause');
 await page.getByRole('button',{name:'展开目标',exact:true}).click();assert.equal(await page.locator('.goal-copy').evaluate(e=>getComputedStyle(e.querySelector('p')).whiteSpace),'normal');
 await page.getByRole('button',{name:'查看 第三方子 Agent 的工作过程',exact:true}).click();await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
 await page.getByRole('combobox',{name:'模型上下文大小'}).selectOption('large');assert.equal(await page.getByLabel('操作结果').textContent(),'large');
 await page.getByRole('button',{name:'第三方模型，高',exact:true}).click();assert.equal(await page.getByRole('button',{name:'第三方模型，高',exact:true}).getAttribute('aria-pressed'),'true');
 assert(await page.getByRole('button',{name:'第三方模型，最高',exact:true}).isDisabled());
 await page.getByRole('button',{name:'快速',exact:true}).focus();await page.keyboard.press('Space');assert.equal(await page.getByLabel('操作结果').textContent(),'fast');
 await page.getByRole('button',{name:'应用',exact:true}).click();assert.equal(await page.getByLabel('操作结果').textContent(),'layout:apply');
 const field=page.getByRole('textbox',{name:'普通输入'});
 assert.equal(await field.evaluate(e=>getComputedStyle(e).borderTopLeftRadius),'0px');
 assert.equal(await field.evaluate(e=>getComputedStyle(e).borderLeftWidth),'4px');
 await field.fill('新的名称');assert.equal(await field.inputValue(),'新的名称');
 await page.getByRole('combobox',{name:'原生选择'}).selectOption('second');
 assert.equal(await page.getByRole('combobox',{name:'原生选择'}).inputValue(),'second');
 await page.getByRole('checkbox',{name:'复选选择'}).check();
 assert(await page.getByRole('checkbox',{name:'复选选择'}).isChecked());
 await page.getByRole('switch',{name:'开关选择'}).check();
 assert(await page.getByRole('switch',{name:'开关选择'}).isChecked());
 await page.getByRole('radio',{name:'第二个'}).check();
 assert(await page.getByRole('radio',{name:'第二个'}).isChecked());
 assert(await page.getByRole('textbox',{name:'不可编辑'}).isDisabled());
 assert.equal(await page.getByRole('textbox',{name:'校验错误'}).getAttribute('aria-describedby'),'validation-message');
 for(const theme of ['light','dark']) {
   if(await page.locator('.app-shell').getAttribute('data-ui-theme')!==theme)await page.getByRole('button',{name:'切换主题'}).click();
   await field.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');
   await field.evaluate(e=>Promise.all(e.getAnimations().map(a=>a.finished)));const focusRing=await field.evaluate(e=>{const s=getComputedStyle(e);return {top:s.borderTopColor,shadow:s.boxShadow}});assert.equal(focusRing.top,theme==='light'?'rgb(0, 117, 168)':'rgb(34, 187, 255)','ak-form focus recolours the whole border');assert.match(focusRing.shadow,/ 0px 0px 0px 3px$/,'keyboard focus keeps a visible 3px halo');
   assert.equal(await field.evaluate(e=>getComputedStyle(e).borderLeftColor),theme==='light'?'rgb(0, 117, 168)':'rgb(34, 187, 255)');
   assert.equal(await page.getByRole('textbox',{name:'校验错误'}).evaluate(e=>getComputedStyle(e).borderLeftColor),theme==='light'?'rgb(166, 52, 53)':'rgb(255, 170, 163)');
   assert.equal(await page.getByRole('switch',{name:'开关选择'}).evaluate(e=>getComputedStyle(e).borderTopLeftRadius),'16px');
   assert.equal(await page.getByRole('radio',{name:'第二个'}).evaluate(e=>getComputedStyle(e).borderTopLeftRadius),'50%');
   assert.equal(await page.getByRole('radio',{name:'第二个'}).evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(34, 187, 255)');
   await page.getByRole('switch',{name:'开关选择'}).scrollIntoViewIfNeeded();
   await page.screenshot({path:`/tmp/aibo-ak-controls/forms-${theme}.png`});
   const shapes=await page.locator('.goal-bar,.subagent-card,.ak-model-matrix-wrap,.settings-rows').evaluateAll(es=>es.map(e=>parseFloat(getComputedStyle(e).borderTopLeftRadius)));
   assert(shapes.every(radius=>radius<=3),JSON.stringify(shapes));
   const targets=await page.locator('.ak-model-matrix button,select').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().height));assert(targets.every(h=>h>=44));
   assert.equal(await page.locator('svg.lucide').count(),0);
   await page.screenshot({path:`/tmp/aibo-ak-controls/${theme}.png`});
 }
 await page.getByRole('button',{name:'切换忙碌'}).click();assert(await page.getByRole('combobox',{name:'模型上下文大小'}).isDisabled());assert(await page.getByRole('button',{name:'暂停目标',exact:true}).isDisabled());assert(await page.getByRole('button',{name:'第三方模型，高',exact:true}).isDisabled());
 await page.setViewportSize({width:390,height:844});assert((await page.locator('.goal-copy').boundingBox()).width >= 220, 'narrow goal text gets a full readable column');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'/tmp/aibo-ak-controls/narrow.png'});
 assert.deepEqual(errors,[]);console.log('PASS: ak-ui controls and forms retain actions, native selection, disabled/error/focus states, 44px targets and small geometry in both themes and narrow viewport.');
} catch(error) {console.error(JSON.stringify({errors}));await page.screenshot({path:'/tmp/aibo-ak-controls/failure.png'});throw error;} finally {await browser.close();await server.close()}
