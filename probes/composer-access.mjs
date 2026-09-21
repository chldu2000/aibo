import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const server = await createServer({server:{host:'127.0.0.1',port:0,hmr:false,watch:null}});
await server.listen();
let browser;
try {
  browser = await chromium.launch({headless:true});
  for (const [kit,theme] of [['shadcn','zinc'],['shadcn','light'],['material3','ocean'],['material3','daylight']]) {
    for (const agent of ['codex', 'pi', 'custom']) {
      const page = await browser.newPage({viewport:{width:1000,height:760}});
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/probes/composer-access.html`);
      await page.waitForFunction(() => window.composerAccessProbe);
      const controls = await page.evaluate(({kit,agent,theme}) => window.composerAccessProbe.show(kit,agent,theme), {kit,agent,theme});
      await page.locator('.composer-access-control').click();
      const choices = page.getByRole('menuitemradio');
      assert.equal(await choices.count(), 3);
      const appearances = await choices.evaluateAll(options => options.map(option => {const icon=option.querySelector('svg');return {icon:icon?.innerHTML,color:icon?getComputedStyle(icon).color:null};}));
      assert.equal(new Set(appearances.map(value=>value.icon)).size,3,`${kit}/${agent}: each session setting needs a distinct icon`);
      assert.equal(new Set(appearances.map(value=>value.color)).size,3,`${kit}/${agent}: each session setting needs a distinct color`);
      assert.equal(await page.getByRole('menuitemradio', {name:/^计划/}).count(), agent === 'pi' ? 1 : 0);
      await page.getByRole('menuitemradio', {name:agent==='codex'?/^Full Access/:agent==='pi'?/^工作区写入/:/^Outline first/}).click();
      assert.deepEqual(await page.evaluate(() => window.composerAccessProbe.actions()), [agent==='codex'?'full-access':agent==='pi'?'workspace-write':'outline-first']);
      for (const selectedControl of controls) {
        await page.evaluate(({kit,agent,theme,selectedControl}) => window.composerAccessProbe.show(kit,agent,theme,selectedControl),{kit,agent,theme,selectedControl});
        const current = await page.locator('.composer-access-control .session-control-mark svg').evaluateAll(icons=>icons.map(icon=>({icon:icon.innerHTML,color:getComputedStyle(icon).color})));
        assert.ok(current.some(value=>value.icon===appearances[controls.indexOf(selectedControl)].icon && value.color===appearances[controls.indexOf(selectedControl)].color),`${kit}/${agent}: toolbar must reflect ${selectedControl}`);
      }
      await page.locator('.composer-access-control').click();
      await page.getByRole('menu',{name:'会话设置',exact:true}).screenshot({path:`/tmp/aibo-session-controls-${kit}-${theme}-${agent}.png`});
      assert.deepEqual(errors, []);
      console.log(`${kit}/${theme}/${agent}: distinct icons/colors, selected toolbar and option dispatch passed`);
      await page.close();
    }
  }
} finally { await browser?.close(); await server.close(); }
