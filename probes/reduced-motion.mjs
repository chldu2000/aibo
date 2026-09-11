import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const server = await createServer({server:{host:'127.0.0.1',port:0,hmr:false,watch:null}}); await server.listen();
const browser = await chromium.launch({headless:true}), results = [];
try {
  const page = await browser.newPage({viewport:{width:1440,height:1000}}), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/probes/reduced-motion.html`);
  await page.waitForFunction(() => window.motionProbe);
  const inspect = () => page.evaluate(() => [...document.querySelectorAll('body *')].flatMap(element => ['', '::before', '::after'].map(pseudo => {
    const style = getComputedStyle(element, pseudo || null);
    const max = value => Math.max(...value.split(',').map(Number.parseFloat));
    return {tag:element.tagName,animation:style.animationName,duration:max(style.animationDuration),delay:max(style.animationDelay),iterations:style.animationIterationCount,transition:max(style.transitionDuration),transitionDelay:max(style.transitionDelay),scroll:style.scrollBehavior};
  })));
  for (const kit of ['shadcn','material3']) {
    await page.evaluate(kit => window.motionProbe.setUiKit(kit), kit);
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.getByRole('img',{name:'正在运行的插件'}).waitFor();
    const normal = await inspect();
    assert.ok(normal.some(item => item.animation !== 'none' && item.duration > .01), 'running indicator must animate normally');
    assert.ok(normal.some(item => item.transition > .01), 'normal skin transitions must be retained');
    await page.emulateMedia({reducedMotion:'reduce'});
    const reduced = await inspect();
    assert.deepEqual(reduced.filter(item => item.duration > .000011 || item.delay !== 0 || item.transition > .000011 || item.transitionDelay !== 0 || item.iterations.includes('infinite') || item.scroll === 'smooth'), []);
    await page.getByRole('button',{name:'交换工作台侧边区域',exact:true}).click();
    await page.waitForFunction(() => document.querySelector('[data-presentation-layout]')?.dataset.presentationLayout === 'review');
    await page.getByRole('button',{name:'恢复默认呈现',exact:true}).click();
    await page.waitForFunction(() => document.querySelector('[data-presentation-layout]')?.dataset.presentationLayout === 'standard');
    results.push({kit,normalAnimation:true,normalTransitions:true,checkedStyles:reduced.length,reducedMotionComputed:true,layoutRecovery:true});
  }
  assert.deepEqual(errors, []);
  await writeFile('/tmp/aibo-p4-reduced-motion.json',JSON.stringify({results},null,2)+'\n'); console.log(JSON.stringify({results}));
} finally { await browser.close(); await server.close(); }
