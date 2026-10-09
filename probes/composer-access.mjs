import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const server = await createServer({server:{host:'127.0.0.1',port:0,hmr:false,watch:null}});
await server.listen();
let browser;
try {
  browser = await chromium.launch({headless:true});
  for (const [kit,theme] of [['ak-ui','dark'],['ak-ui','light'],['material3','dark'],['material3','light']]) {
    for (const agent of ['codex', 'pi', 'custom']) {
      const page = await browser.newPage({locale:'zh-CN',viewport:{width:1000,height:760}});
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/probes/composer-access.html`);
      await page.waitForFunction(() => window.composerAccessProbe);
      const controls = await page.evaluate(({kit,agent,theme}) => window.composerAccessProbe.show(kit,agent,theme), {kit,agent,theme});
      // Match the workbench's clipping boundary around the conversation pane.
      await page.locator('#probe').evaluate(node => { node.style.overflow = 'hidden'; });
      await page.locator('.composer-access-control').click();
      const menu = page.getByRole('menu', {name:'会话设置',exact:true});
      assert.ok(await menu.evaluate(node => {
        const rect = node.getBoundingClientRect();
        return node.contains(document.elementFromPoint(rect.left + 8, rect.top + 20));
      }), `${kit}/${agent}: the left edge must remain visible outside a clipping ancestor`);
      const choices = page.getByRole('menuitemradio');
      assert.equal(await choices.count(), 3);
      const appearances = await choices.evaluateAll(options => options.map(option => {const icon=option.querySelector('svg');return {icon:icon?.innerHTML,color:icon?getComputedStyle(icon).color:null};}));
      assert.equal(new Set(appearances.map(value=>value.icon)).size,3,`${kit}/${agent}: each session setting needs a distinct icon`);
      // Material 3 intentionally shares its warning token between plan and elevated access.
      const colorCount = kit === 'material3' && agent === 'codex' ? 2 : 3;
      assert.equal(new Set(appearances.map(value=>value.color)).size,colorCount,`${kit}/${agent}: session colors follow the kit palette`);
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
      assert.equal(await menu.locator('[aria-checked="true"]').first().evaluate(node => node === document.activeElement), true, 'opening focuses the selected option');
      await page.keyboard.press('Escape');
      await menu.waitFor({state:'detached'});
      assert.equal(await page.locator('.composer-access-control').evaluate(node => node === document.activeElement), true, 'Escape restores trigger focus');
      await page.locator('.composer-access-control').click();
      await page.mouse.click(990, 10);
      await menu.waitFor({state:'detached'});
      assert.equal(await page.locator('.composer-access-control').getAttribute('aria-expanded'), 'false');
      await page.setViewportSize({width:520,height:240});
      await page.evaluate(() => {
        Object.assign(document.querySelector('#frame').style, {width:'100%',height:'100vh',padding:'8px'});
        document.querySelector('#probe').style.marginLeft = '0';
      });
      await page.locator('.composer-access-control').click();
      const small = await menu.evaluate(node => {
        const r = node.getBoundingClientRect();
        return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,scrollable:node.scrollHeight > node.clientHeight};
      });
      assert.ok(small.left >= 8 && small.right <= 512 && small.top >= 8 && small.bottom <= 232, `short window contains the menu: ${JSON.stringify(small)}`);
      assert.ok(small.scrollable, 'long settings remain reachable by scrolling');
      await choices.last().scrollIntoViewIfNeeded();
      assert.ok(await choices.last().evaluate(node => {
        const r = node.getBoundingClientRect();
        return node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
      }), 'last option is visible and clickable after scrolling');
      await choices.last().click();
      await menu.waitFor({state:'detached'});
      await page.locator('.composer-access-control').click();
      await page.setViewportSize({width:560,height:360});
      await menu.waitFor({state:'detached'});
      assert.deepEqual(errors, []);
      console.log(`${kit}/${theme}/${agent}: clipping, short window scrolling, dismissal, focus, icons/colors and option dispatch passed`);
      await page.close();
    }
  }
} finally { await browser?.close(); await server.close(); }
