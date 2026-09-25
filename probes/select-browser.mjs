import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium, webkit } from 'playwright';
const server = await createServer({server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false,watch:null},plugins:[{
  name:'select-fixture',configureServer(server){server.middlewares.use('/__select',(_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<html><body><div id="app"></div><script type="module" src="/probes/fixtures/ak-ui-controls.mjs"></script></body></html>');});},
}]});
await server.listen();
const browser=await (process.env.AIBO_BROWSER === 'webkit' ? webkit : chromium).launch({headless:true,timeout:15000,...(process.env.AIBO_BROWSER_EXECUTABLE?{executablePath:process.env.AIBO_BROWSER_EXECUTABLE}:{})});
const page=await browser.newPage({viewport:{width:960,height:720}}),errors=[];
page.on('pageerror',error=>errors.push(error.message));
page.setDefaultTimeout(10000);page.setDefaultNavigationTimeout(15000);
const base=`http://127.0.0.1:${server.httpServer.address().port}`;
await mkdir('/tmp/aibo-select',{recursive:true});
try {
  for(const kit of ['ak-ui','material3']) {
    await page.goto(`${base}/__select?kit=${kit}&select-cases`);
    const control=page.getByRole('combobox',{name:'模型上下文大小'});
    for(const theme of ['light','dark']) {
      console.log('checking',kit,theme);
      if(await page.locator('.app-shell').getAttribute('data-ui-theme')!==theme)await page.getByRole('button',{name:'切换主题'}).click();
      await control.scrollIntoViewIfNeeded();await control.focus();await page.keyboard.press('Space');
      assert.equal(await control.getAttribute('aria-expanded'),'true');
      await page.keyboard.press('End');
      assert.equal((await control.innerText()).trim(),'标准','navigation does not commit');
      await page.screenshot({path:`/tmp/aibo-select/${kit}-${theme}.png`});
      const list=page.getByRole('listbox',{name:'模型上下文大小'});
      assert(await list.evaluate(element=>element.matches(':popover-open')));
      const styles=await list.evaluate(element=>{const s=getComputedStyle(element);return {background:s.backgroundColor,color:s.color,border:s.borderTopWidth,radius:s.borderTopLeftRadius};});
      assert.notEqual(styles.background,'rgba(0, 0, 0, 0)');assert.notEqual(styles.background,styles.color);assert.equal(styles.border,'1px');assert.equal(styles.radius,kit==='ak-ui'?'0px':'12px');
      await page.keyboard.press('Escape');assert.equal(await control.getAttribute('aria-expanded'),'false');assert(await control.evaluate(e=>e===document.activeElement));
      await control.click();await page.getByRole('option',{name:'扩展',exact:true}).click();assert.equal((await control.innerText()).trim(),'扩展');
      await control.press('Space');await control.press('Home');await control.press('Enter');assert.equal((await control.innerText()).trim(),'标准');
      await control.press('Space');await control.press('Tab');assert.equal(await control.getAttribute('aria-expanded'),'false');
      await control.click();await page.getByRole('button',{name:'切换忙碌'}).click();assert(await control.isDisabled());assert.equal(await control.getAttribute('aria-expanded'),'false');await page.getByRole('button',{name:'切换忙碌'}).click();
      await control.click();await control.evaluate(e=>{let parent=e.parentElement;while(parent&&parent.scrollHeight<=parent.clientHeight)parent=parent.parentElement; if(!parent)throw Error('missing scroll ancestor');parent.scrollTop+=100;});await page.waitForFunction(()=>document.querySelector('[aria-label="模型上下文大小"]').getAttribute('aria-expanded')==='false');
    }
    const long=page.getByRole('combobox',{name:'长列表'});
    await long.scrollIntoViewIfNeeded();await long.press('Space');await long.press('ArrowDown');await long.press('Enter');assert.equal((await long.innerText()).trim(),'Item 02','skip disabled item');
    await long.press('Space');await long.press('End');assert.equal(await long.getAttribute('aria-expanded'),'true','scroll within list stays open');
    const popup=page.getByRole('listbox',{name:'长列表'});assert(await popup.evaluate(e=>e.scrollTop>0));
    await long.press('Enter');assert.equal((await long.innerText()).trim(),'Item 39');
    await long.press('Space');await page.keyboard.type('Item 09');await long.press('Enter');assert.equal((await long.innerText()).trim(),'Item 09','typeahead selects matching label');
    await long.press('Space');const bounds=await popup.boundingBox();assert(bounds.y>=0&&bounds.y+bounds.height<=720,'popup flips to remain in viewport');await long.press('Escape');
    const choices=page.getByRole('combobox',{name:'皮肤选择'});await choices.scrollIntoViewIfNeeded();await choices.press('Space');await choices.press('End');await choices.press('Enter');assert.equal((await choices.innerText()).trim(),'第二个选项');
  }
  // The same native tree contract is drawn by the isolated trusted bridge.
  await page.goto(`${base}/probes/presentation-sandbox.html`);await page.waitForFunction(()=>Boolean(window.sandboxProbe));
  const source=`self.aiboPresentation={render(input){return {tag:'div',key:'root',className:'workbench',children:[{tag:'select',key:'choice',attrs:{'aria-label':'External choice',disabled:!!input.data.disabled},events:{change:'choose'},children:[{tag:'option',key:'a',text:'Alpha',attrs:{value:'a',selected:input.data.value!=='c'}},{tag:'option',key:'b',text:'Blocked',attrs:{value:'b',disabled:true}},{tag:'option',key:'c',text:'Charlie',attrs:{value:'c',selected:input.data.value==='c'}}]},{tag:'button',key:'next',text:'Next'}]}}};`;
  await page.evaluate(source=>window.sandboxProbe.mount(source),source);
  const frame=page.frameLocator('iframe'),control=frame.getByRole('combobox',{name:'External choice'});
  for(const skin of ['legacy','shadcn','material3']) {
    const css=skin==='legacy'?'.workbench [role=listbox]{display:grid;gap:4px}button{color:var(--foreground);background:var(--background)}':await readFile(`packages/presentation-${skin}/skin.css`,'utf8');
    await control.evaluate((element,css)=>{const doc=element.ownerDocument;doc.querySelector('#probe-select-style')?.remove();const style=doc.createElement('style');style.id='probe-select-style';style.textContent=css;doc.head.append(style);doc.documentElement.style.cssText='--foreground:#eee;--background:#111;--card:#222;--border:#555;--radius:8px;--accent:#333;--accent-foreground:#eee;--primary:#acf;--primary-foreground:#111;--ring:#acf';},css);
    assert.equal(await frame.getByRole('listbox').count(),0,'closed popup stays hidden with older package CSS');
    await control.click();assert.equal(await frame.getByRole('listbox').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(34, 34, 34)');assert(await frame.getByRole('option',{name:'Blocked'}).isDisabled());
    const before=await page.evaluate(()=>window.sandboxProbe.intents.length);
    await frame.getByRole('option',{name:'Charlie'}).evaluate(e=>e.click());assert.equal(await page.evaluate(()=>window.sandboxProbe.intents.length),before,'synthetic option click rejected');
    await control.press('ArrowDown');await control.press('Enter');
    await page.waitForFunction(count=>window.sandboxProbe.intents.length===count,before+1);
    assert.deepEqual(await page.evaluate(()=>{const {id,event,value}=window.sandboxProbe.intents.at(-1);return {id,event,value};}),{id:'choose',event:'change',value:'c'});
    await page.evaluate(()=>window.sandboxProbe.update({value:'c'}));await control.filter({hasText:'Charlie'}).waitFor();
    assert(await control.evaluate(e=>document.activeElement===e),'keyed focus retained');
    await control.click();await page.screenshot({path:`/tmp/aibo-select/external-${skin}.png`});await control.press('Escape');
    await page.evaluate(()=>window.sandboxProbe.update({value:'a'}));await control.filter({hasText:'Alpha'}).waitFor();
  }
  await page.evaluate(()=>window.sandboxProbe.update({disabled:true}));await control.evaluate(e=>e.disabled||new Promise(resolve=>setTimeout(resolve,100)));assert(await control.isDisabled());
  assert.deepEqual(errors,[]);
  console.log('PASS: skin-owned popovers in both kits and themes; keyboard, focus, disabled, cancellation, scroll; external skin selection, disabled options, trusted change actions and keyed focus.');
} finally {await browser.close();await server.close();}
