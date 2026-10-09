import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright';
const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false,watch:null}});
await server.listen();
const browser=await chromium.launch({headless:true});
const errors=[];
try {
  for (const kit of ['material3','ak-ui']) for (const theme of ['light','dark']) {
    const page=await browser.newPage({locale:'zh-CN',viewport:{width:1280,height:800}});
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/probes/background-tasks-browser.html`);
    await page.evaluate(async ({kit,theme})=>{const r=await import('/src/lib/ui-kit/registry.ts');r.setUiKit(kit);r.setUiTheme(theme);},{kit,theme});
    await page.getByText('运行中',{exact:true}).waitFor();
    assert.equal(await page.getByText('python eval.py --input <script>alert(1)</script>',{exact:true}).count(),1);
    const details=page.locator('summary'); await details.focus(); await page.keyboard.press('Enter');
    await page.getByText('任务 ID：shell-42',{exact:true}).waitFor();
    await page.evaluate(()=>window.finishBackgroundTask());
    await page.getByText('失败',{exact:true}).waitFor();
    await page.getByText('退出码：2',{exact:true}).waitFor();
    await page.setViewportSize({width:390,height:680});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'card fits narrow viewport');
    await page.screenshot({path:`/tmp/aibo-background-${kit}-${theme}.png`});
    await page.close();
  }
  assert.deepEqual(errors,[]);
  console.log('Background tasks: both kits, light/dark, status updates, literal output, keyboard details, narrow viewport passed.');
} finally {await browser.close();await server.close();}
