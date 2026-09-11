import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
const server=await createServer({server:{host:'127.0.0.1',port:0}});await server.listen();
const browser=await chromium.launch({headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
try{
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/probes/workbench-lifecycle.html`);
 await page.getByRole('textbox',{name:'插件草稿'}).fill('PLUGIN_DRAFT');
 await page.getByRole('button',{name:'捕获旧回调'}).click();
 await page.getByRole('textbox',{name:'草稿',exact:true}).fill('DRAFT_DURING_STREAM');await page.getByRole('textbox',{name:'草稿',exact:true}).focus();
 const before=await page.evaluate(()=>window.lifecycleProbe.state());
 await page.evaluate(()=>window.lifecycleProbe.switch('focus',true));
 await page.getByRole('alert').waitFor();
 assert.equal(await page.locator('[data-presentation-layout]').getAttribute('data-presentation-layout'),'standard');
 assert.equal(await page.getByRole('textbox',{name:'草稿',exact:true}).inputValue(),'DRAFT_DURING_STREAM');
 assert.equal(await page.getByRole('textbox',{name:'插件草稿'}).inputValue(),'PLUGIN_DRAFT');
 assert.equal(await page.evaluate(()=>document.activeElement?.dataset.presentationFocus),'draft');
 await page.evaluate(()=>window.lifecycleProbe.old());
 assert.equal((await page.evaluate(()=>window.lifecycleProbe.state())).actions,0);
 await page.getByRole('button',{name:'执行动作'}).click();
 assert.equal((await page.evaluate(()=>window.lifecycleProbe.state())).actions,1);
 await page.getByRole('button',{name:'捕获旧回调'}).click();
 await page.evaluate(()=>window.lifecycleProbe.select('b'));
 await page.waitForFunction(()=>window.lifecycleProbe.state().sessionId==='b');
 await page.evaluate(()=>window.lifecycleProbe.old());
 assert.equal((await page.evaluate(()=>window.lifecycleProbe.state())).actions,1);
 assert.equal(await page.getByRole('textbox',{name:'插件草稿'}).inputValue(),'');
 await page.evaluate(()=>window.lifecycleProbe.select('a'));
 await page.waitForFunction(()=>document.querySelector('label input')?.value==='PLUGIN_DRAFT');
 await page.waitForFunction(before=>window.lifecycleProbe.state().chunks>before,before.chunks);
 for (const kit of ['shadcn', 'material3']) {
  await page.evaluate(kit => window.lifecycleProbe.kit(kit), kit);
  await page.evaluate(() => window.lifecycleProbe.switch('standard'));
  await page.getByRole('complementary', {name:'槽位导航'}).waitFor();
  await page.getByRole('complementary', {name:'槽位辅助'}).waitFor();
  await page.evaluate(() => window.lifecycleProbe.switch('focus'));
  assert.equal(await page.getByRole('complementary', {name:'槽位导航'}).count(), 0);
  assert.equal(await page.getByRole('complementary', {name:'槽位辅助'}).count(), 0);
  assert.equal(await page.getByRole('textbox', {name:'草稿', exact:true}).inputValue(), 'DRAFT_DURING_STREAM');
  await page.getByRole('button', {name:'浮层操作'}).click();
  await page.getByRole('button', {name:'恢复默认呈现', exact:true}).click();
  await page.getByRole('complementary', {name:'槽位导航'}).waitFor();
 }
 assert.deepEqual(errors,[]);
 const result={namedSlotsBothSkins:true,focusOmitsNavigationAndAuxiliary:true,overlaysReachable:true,pluginFormSurvivesRemount:true,pluginFormSessionIsolation:true,failedMountFallback:true,streamContinues:true,draft:true,semanticFocus:true,oldGenerationRejected:true,oldSessionRejected:true,currentActions:true};
 await writeFile('/tmp/aibo-p2-workbench-lifecycle.json',JSON.stringify(result,null,2)+'\n');console.log(result);
}finally{await browser.close();await server.close();}
