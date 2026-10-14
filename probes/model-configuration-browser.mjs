import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
const output = process.env.AIBO_MODEL_EVIDENCE ?? '/tmp/aibo-p2-model-matrix';
await mkdir(output, { recursive: true });
const server = await createServer({ server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false } });
await server.listen();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({locale:'zh-CN', viewport: { width: 1100, height: 700 } });
const errors = [], results = [];
page.on('pageerror', error => errors.push(String(error)));
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/probes/model-configuration.html`);
  await page.waitForFunction(() => Boolean(window.modelProbe));
  for (const kit of ['ak-ui', 'material3']) for (const theme of ['light', 'dark']) {
    await page.evaluate(({kit,theme}) => window.modelProbe.render(kit,theme), {kit,theme});
    await page.getByRole('button', { name: /Test Model/ }).click();
    assert.equal(await page.getByRole('button', { name: 'Test Model，high', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.getByRole('columnheader', { name: '保留', exact: true }).count(), 1);
    await page.getByRole('button', { name: 'Test Model，medium', exact: true }).click();
    await page.getByRole('button', { name: 'Test Model · medium', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Test Model，medium', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: 'Test Model，保留', exact: true }).click();
    await page.getByRole('button', { name: 'Test Model · medium', exact: true }).waitFor();
    await page.evaluate(() => window.modelProbe.render());
    await page.getByRole('button', { name: 'Test Model · medium', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Test Model，medium', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.screenshot({ path: `${output}/${kit}-${theme}.png` });
    await page.getByRole('button', { name: 'Test Model，high', exact: true }).click();
    await page.getByRole('button', { name: 'Test Model · high', exact: true }).waitFor();
    await page.setViewportSize({width:800,height:480});
    for (const width of [260, 340, 600]) {
      await page.evaluate(width => {
        const host = document.getElementById('probe');
        host.style.cssText = `width:${width}px;overflow:hidden;position:relative;isolation:isolate`;
      }, width);
      const buttons = page.locator('.composer-toolbar > .composer-toolbar-group > .composer-menu-anchor > button, .composer-toolbar-end > button');
      const boxes = await buttons.evaluateAll(nodes => nodes.map(n => {
        const r=n.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};
      }));
      for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++) {
        const a=boxes[i],b=boxes[j];
        assert(a.right<=b.left+1||b.right<=a.left+1||a.bottom<=b.top+1||b.bottom<=a.top+1,`${kit}: toolbar buttons do not overlap at ${width}px`);
      }
      assert(await page.locator('.composer-toolbar').evaluate(n=>n.scrollWidth<=n.clientWidth+1),'toolbar fits available pane width');
      const trigger=page.locator('.composer-model-control');
      await trigger.click();
      const menu=page.locator('.composer-model-menu');
      assert(await menu.evaluate(n=>n.matches(':popover-open')),'matrix uses top layer');
      assert(await menu.evaluate(n=>{
        const r=n.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;
      }),'matrix fits window bounds');
      const choice=page.getByRole('button',{name:'Test Model，high',exact:true});
      assert(await choice.evaluate(n=>{
        const r=n.getBoundingClientRect();return n.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));
      }),'matrix choice is not clipped by composer ancestors');
      await page.screenshot({path:`${output}/${kit}-${theme}-narrow-${width}.png`});
      await page.keyboard.press('Escape');
      await menu.waitFor({state:'detached'});
      assert.equal(await trigger.getAttribute('aria-expanded'),'false');
      await page.locator('.composer-access-control').click();
      assert(await page.locator('.composer-profile-menu').evaluate(n=>n.matches(':popover-open')),'session controls retain top layer behavior');
      await page.keyboard.press('Escape');
    }
    await page.evaluate(()=>document.getElementById('probe').removeAttribute('style'));
    await page.setViewportSize({width:1100,height:700});
    results.push({ kit, theme, initialHigh: true, switchMedium: true, preserve: true, remountMedium: true });
  }
  assert.deepEqual(errors, []);
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify(results));
} finally { await browser.close(); await server.close(); }
