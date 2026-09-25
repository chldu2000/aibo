import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {createServer} from 'vite';
import {chromium} from 'playwright';

const server = await createServer({server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false,watch:null},plugins:[{
  name:'material-controls-fixture',configureServer(server) {
    server.middlewares.use('/__controls',(_req,res)=>{
      res.setHeader('Content-Type','text/html');
      res.end('<html><meta name="viewport" content="width=device-width, initial-scale=1"><body><div id="app"></div><script type="module" src="/probes/fixtures/ak-ui-controls.mjs"></script></body></html>');
    });
  },
}]});
await server.listen();
const browser = await chromium.launch({headless:true});
const page = await browser.newPage({viewport:{width:1100,height:1000}});
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
await mkdir('/tmp/aibo-material3-controls',{recursive:true});
const styles = locator => locator.evaluateAll(elements => elements.map(element=>{
  const s=getComputedStyle(element);
  return Object.fromEntries(['color','backgroundColor','borderTopLeftRadius','borderTopWidth','borderLeftWidth','borderTopColor','boxShadow','clipPath','fontFamily','fontSize','padding','minHeight','outlineWidth'].map(key=>[key,s[key]]));
}));
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__controls?kit=material3`);
  const field = page.getByRole('textbox',{name:'普通输入'});
  for (const theme of ['light','dark']) {
    if(await page.locator('.app-shell').getAttribute('data-ui-theme') !== theme) await page.getByRole('button',{name:'切换主题'}).click();
    await field.fill(`保留 ${theme} 输入`);
    for(const label of ['普通输入','校验错误','不可编辑','多行输入']) {
      const [s]=await styles(page.getByRole('textbox',{name:label}));
      assert.equal(s.borderTopLeftRadius,'8px',label);
      assert.equal(s.borderLeftWidth,s.borderTopWidth,`${label}: no ak-form left rail`);
      assert.doesNotMatch(s.boxShadow,/inset/,label);
    }
    await field.focus();
    const [focused]=await styles(field);
    assert.equal(focused.borderLeftWidth,'1px');
    assert.equal(focused.borderTopColor,theme==='light'?'rgb(36, 94, 167)':'rgb(167, 200, 255)');
    assert.doesNotMatch(focused.boxShadow,/inset/);
    await page.getByRole('combobox',{name:'模型上下文大小'}).selectOption('large');
    assert.equal(await page.getByLabel('操作结果').textContent(),'large');
    await page.getByRole('button',{name:'第三方模型，高',exact:true}).click();
    assert.equal(await page.getByRole('button',{name:'第三方模型，高',exact:true}).getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('.effort-selection').evaluate(e=>getComputedStyle(e).display),'none');
    await page.getByRole('button',{name:'快速',exact:true}).click();
    const [fast]=await styles(page.getByRole('button',{name:'快速',exact:true}));
    assert.equal(fast.borderTopLeftRadius,'8px');
    assert.doesNotMatch(fast.boxShadow,/inset/);
    for(const s of await styles(page.locator('.variant-fixture [data-slot="button"]'))) {
      assert.equal(s.borderTopLeftRadius,'999px');
      assert.equal(s.clipPath,'none');
    }
    for(const s of await styles(page.locator('.variant-fixture [data-slot="badge"]'))) {
      assert.equal(s.borderTopLeftRadius,'6px');
      assert.doesNotMatch(s.boxShadow,/inset/);
    }
    await page.getByRole('checkbox',{name:'复选选择'}).check();
    await page.getByRole('switch',{name:'开关选择'}).check();
    await page.getByRole('radio',{name:'第二个'}).check();
    const [radio]=await styles(page.getByRole('radio',{name:'第二个'}));
    assert.equal(radio.backgroundColor,theme==='light'?'rgb(36, 94, 167)':'rgb(167, 200, 255)');
    await page.screenshot({path:`/tmp/aibo-material3-controls/${theme}.png`,fullPage:true});
    // Delete every ak-ui scoped rule and palette variable. M3 must render identically.
    const controls=page.locator('button,input,select,textarea,[data-slot="badge"],.ui-model-matrix-wrap');
    await controls.evaluateAll(elements => Promise.all(elements.flatMap(element => element.getAnimations()).map(animation => animation.finished)));
    const before=await styles(controls);
    await page.evaluate(()=>{
      function removeAkRules(sheet) {
        for(let i=sheet.cssRules.length-1;i>=0;i--) {
          const rule=sheet.cssRules[i];
          if(rule.selectorText?.includes("data-ui-kit='ak-ui'") || rule.selectorText?.includes('data-ui-kit="ak-ui"')) sheet.deleteRule(i);
          else if(rule.cssRules) removeAkRules(rule);
          else if(rule.style) for(const key of [...rule.style]) if(key.startsWith('--ak-')) rule.style.removeProperty(key);
        }
      }
      for(const sheet of document.styleSheets) removeAkRules(sheet);
    });
    assert.deepEqual(await styles(controls),before,`${theme}: Material 3 must not depend on ak-ui CSS or tokens`);
    assert.equal(await field.inputValue(),`保留 ${theme} 输入`);
  }
  await page.getByRole('button',{name:'切换忙碌'}).click();
  assert(await page.getByRole('combobox',{name:'模型上下文大小'}).isDisabled());
  assert(await page.getByRole('button',{name:'第三方模型，高',exact:true}).isDisabled());
  assert.deepEqual(errors,[]);
  console.log('PASS: Material 3 control variants, badges, inputs, focus/error/disabled states, model selection and native choices; identical rendering with all ak-ui rules and tokens removed.');
} finally { await browser.close(); await server.close(); }
