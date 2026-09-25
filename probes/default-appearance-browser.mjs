import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createBuiltinWorkbenchServer} from './lib/builtin-workbench-fixture.mjs';

const server=await createBuiltinWorkbenchServer();
await server.listen();
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1280,height:900}});
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
async function assertAppearance(kit,theme) {
  await page.locator('.assistant-entry').waitFor();
  assert.equal(await page.locator('.app-shell').getAttribute('data-ui-kit'),kit);
  assert.equal(await page.locator('.app-shell').getAttribute('data-ui-theme'),theme);
}
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
  await assertAppearance('material3','light');
  assert.equal(await page.locator('.sidebar-new-session').evaluate(element=>getComputedStyle(element).backgroundColor),'rgb(215, 231, 255)');
  await page.getByRole('button',{name:'切换明暗主题',exact:true}).click();
  await assertAppearance('material3','dark');
  await page.reload();
  await assertAppearance('material3','dark');
  for(const [stored,kit,theme] of [
    [null,'material3','light'],
    ['broken JSON','material3','light'],
    [JSON.stringify({kitId:'unknown',themeId:'light'}),'material3','light'],
    [JSON.stringify({kitId:'material3',themeId:'unknown'}),'material3','light'],
    [JSON.stringify({kitId:'ak-ui',themeId:'dark'}),'ak-ui','dark'],
    [JSON.stringify({kitId:'material3',themeId:'plum-dark'}),'material3','plum-dark'],
    [JSON.stringify({kitId:'shadcn',themeId:'zinc'}),'ak-ui','dark'],
  ]) {
    await page.evaluate(stored=>{
      localStorage.setItem('probe.unrelated','preserved');
      if(stored===null)localStorage.removeItem('aibo.appearance.v1');
      else localStorage.setItem('aibo.appearance.v1',stored);
    },stored);
    await page.reload();
    await assertAppearance(kit,theme);
    assert.equal(await page.evaluate(()=>localStorage.getItem('probe.unrelated')),'preserved');
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: fresh/corrupt/missing/unknown preferences default to Material 3 blue light; brightness persists; saved ak-ui, Material 3 palette and legacy migrations retain their choices.');
} finally {await browser.close();await server.close();}
