import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const server = await createServer({server:{host:'127.0.0.1',port:0,hmr:false,watch:null}});
await server.listen();
let browser;
try {
  browser = await chromium.launch({headless:true});
  for (const kit of ['shadcn', 'material3']) {
    for (const agent of ['codex', 'pi', 'custom']) {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/probes/composer-access.html`);
      await page.waitForFunction(() => window.composerAccessProbe);
      await page.evaluate(({kit,agent}) => window.composerAccessProbe.show(kit,agent), {kit,agent});
      await page.locator('.composer-access-control').click();
      const choices = page.getByRole('menuitemradio');
      assert.equal(await choices.count(), 3);
      assert.equal(await page.getByRole('menuitemradio', {name:/^计划/}).count(), agent === 'pi' ? 1 : 0);
      await page.getByRole('menuitemradio', {name:agent==='codex'?/^Full Access/:agent==='pi'?/^工作区写入/:/^Outline first/}).click();
      assert.deepEqual(await page.evaluate(() => window.composerAccessProbe.actions()), [agent==='codex'?'full-access':agent==='pi'?'workspace-write':'outline-first']);
      assert.deepEqual(errors, []);
      console.log(`${kit}/${agent}: permission options visible and selection dispatched`);
      await page.close();
    }
  }
} finally { await browser?.close(); await server.close(); }
