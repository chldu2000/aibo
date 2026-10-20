import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {createServer} from 'vite';
import {chromium} from 'playwright';
// Compact goal bar: one line while collapsed, wrapped objective when expanded, compact actions with full hit areas.
const server=await createServer({server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false,watch:null},plugins:[{
  name:'goal-bar-fixture',configureServer(server){server.middlewares.use('/__goal-bar',(_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<html><meta name="viewport" content="width=device-width, initial-scale=1"><body><div id="app"></div><script type="module" src="/probes/fixtures/ak-ui-controls.mjs"></script></body></html>')})}
}]});
await server.listen();const browser=await chromium.launch({headless:true});const errors=[];
await mkdir('/tmp/aibo-goal-bar',{recursive:true});
const url=kit=>`http://127.0.0.1:${server.httpServer.address().port}/__goal-bar?kit=${kit}`;
try {
  for(const kit of ['material3','ak-ui']) {
    const page=await browser.newPage({locale:'zh-CN',viewport:{width:1100,height:900}});page.on('pageerror',e=>errors.push(e.message));
    await page.goto(url(kit));
    const bar=page.locator('.goal-bar');await bar.waitFor();
    for(const theme of ['light','dark']) {
      if(await page.locator('.app-shell').getAttribute('data-ui-theme')!==theme)await page.getByRole('button',{name:'切换主题'}).click();
      const box=await bar.boundingBox();
      assert(box.height<=42,`${kit}/${theme}: collapsed goal bar is one compact line (${box.height}px)`);
      const radius=await bar.evaluate(e=>parseFloat(getComputedStyle(e).borderTopLeftRadius));
      if(kit==='material3')assert.equal(radius,12,'Material 3 goal bar is an outlined card with corner-medium, not a pill');
      else assert(radius<=3,`ak-ui goal bar keeps square geometry (${radius}px)`);
      const [objective,status]=await Promise.all([bar.locator('p').boundingBox(),bar.locator('small').boundingBox()]);
      assert(Math.abs((objective.y+objective.height/2)-(status.y+status.height/2))<=3,'status and usage share the objective line');
      assert.equal(await bar.locator('p').evaluate(e=>e.scrollWidth>e.clientWidth),true,'long objectives are truncated while collapsed');
      for(const button of await bar.locator('.goal-actions > button').all()) {
        const b=await button.boundingBox();
        assert(b.width<=33&&b.height<=33,`${kit}: goal actions are 32px visible (${b.width}x${b.height})`);
        // The hit area is the button plus its ::before extension, measured from the border edge.
        const hit=await button.evaluate(e=>{const r=e.getBoundingClientRect();const s=getComputedStyle(e);const before=getComputedStyle(e,'::before');
          return {height:parseFloat(before.height)+parseFloat(s.borderTopWidth)+parseFloat(s.borderBottomWidth),reachable:[r.top-5,r.bottom+5].every(y=>e.contains(document.elementFromPoint(r.left+r.width/2,y)))};});
        assert(hit.height>=44&&hit.reachable,`${kit}: goal actions keep a 44px hit area (${hit.height}px)`);
      }
      await page.screenshot({path:`/tmp/aibo-goal-bar/${kit}-${theme}-collapsed.png`,clip:{x:0,y:box.y-12,width:1100,height:box.height+24}});
      const toggle=page.getByRole('button',{name:'展开目标',exact:true});
      await toggle.click();
      const expanded=await bar.boundingBox();
      assert.equal(await bar.locator('p').evaluate(e=>getComputedStyle(e).whiteSpace),'normal');
      assert(expanded.height>box.height+20,'expanding shows the full objective');
      assert((await bar.locator('small').boundingBox()).y>(await bar.locator('p').boundingBox()).y+10,'status moves below the expanded objective');
      await page.screenshot({path:`/tmp/aibo-goal-bar/${kit}-${theme}-expanded.png`,clip:{x:0,y:expanded.y-12,width:1100,height:expanded.height+24}});
      const collapse=page.getByRole('button',{name:'收起目标',exact:true});
      assert.equal(await collapse.getAttribute('aria-expanded'),'true');
      await collapse.click();assert.equal(await page.getByRole('button',{name:'展开目标',exact:true}).getAttribute('aria-expanded'),'false');
    }
    await page.setViewportSize({width:390,height:844});
    assert((await bar.locator('p').boundingBox()).width>=220,`${kit}: narrow goal text keeps a readable column`);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${kit}: narrow goal bar does not overflow`);
    await page.screenshot({path:`/tmp/aibo-goal-bar/${kit}-narrow.png`});
    await page.close();
    const touch=await browser.newPage({locale:'zh-CN',viewport:{width:1100,height:900},hasTouch:true,isMobile:true});touch.on('pageerror',e=>errors.push(e.message));
    await touch.goto(url(kit));await touch.locator('.goal-bar').waitFor();
    if(await touch.evaluate(()=>matchMedia('(pointer: coarse)').matches)) {
      const minimum=kit==='material3'?48:44;
      for(const button of await touch.locator('.goal-actions > button').all())assert((await button.boundingBox()).height>=minimum,`${kit}: touch goal actions are at least ${minimum}px`);
    } else console.log(`${kit}: coarse pointer emulation unavailable; touch target check skipped`);
    await touch.close();
    console.log(`${kit}: compact goal bar passed (one line, truncation, 32px actions with 44px hit area, expand/collapse, narrow, touch)`);
  }
  assert.deepEqual(errors,[]);
} finally {await browser.close();await server.close();}
