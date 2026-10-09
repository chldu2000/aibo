import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createBuiltinWorkbenchServer} from './lib/builtin-workbench-fixture.mjs';

const server = await createBuiltinWorkbenchServer();
await server.listen();
const browser = await chromium.launch({headless:true});
try {
  for (const kitId of ['material3', 'ak-ui']) {
    for (const themeId of ['light', 'dark']) {
      const page = await browser.newPage({locale:'zh-CN', viewport:{width:1440,height:960}});
      await page.addInitScript(selection => localStorage.setItem('aibo.appearance.v1', JSON.stringify(selection)), {kitId,themeId});
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
      await page.locator('.assistant-entry').waitFor();
      for (const kind of ['workspace', 'session']) {
        const row = page.locator(`.${kind}-item-row`).first();
        await row.hover();
        const trigger = row.getByRole('button', {name:/更多操作$/});
        await trigger.hover();
        if (kitId === 'material3') {
          assert.equal(await trigger.evaluate(e => getComputedStyle(e).backgroundColor), 'rgba(0, 0, 0, 0)', 'more trigger still shares the row highlight');
        }
        await trigger.click();
        const menu = page.locator('.row-action-menu:popover-open');
        await menu.waitFor();
        await page.mouse.move(700, 40);
        const items = menu.getByRole('button');
        for (const item of await items.all()) {
          if (await item.isDisabled()) continue;
          const background = () => item.evaluate(e => getComputedStyle(e).backgroundColor);
          const before = await background();
          await item.hover();
          await item.evaluate(e => Promise.all(e.getAnimations().map(a => a.finished)));
          assert.notEqual(await background(), before, `${kitId}/${themeId}/${kind}/${await item.textContent()}: hover must highlight the menu item`);
          await page.mouse.move(700, 40);
          await item.evaluate(e => Promise.all(e.getAnimations().map(a => a.finished)));
        }
        await page.keyboard.press('Escape');
        assert(await trigger.evaluate(e => e === document.activeElement), 'Escape restores trigger focus');
      }
      await page.close();
    }
  }
  console.log('PASS: workspace/session menu hover and Escape focus in both kits and light/dark themes.');
} finally {
  await browser.close();
  await server.close();
}
