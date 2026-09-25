import assert from 'node:assert/strict';
import {readFile, mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
import {createBuiltinWorkbenchServer} from './lib/builtin-workbench-fixture.mjs';

const markdown = await readFile('fixtures/markdown-technical.md','utf8');
const server = await createBuiltinWorkbenchServer({markdown});
await server.listen();
const browser = await chromium.launch({headless:true});
const page = await browser.newPage({viewport:{width:1280,height:900}});
const errors = [];
page.on('pageerror',error => errors.push(error.message));
await page.addInitScript(() => {
  window.markdownCopies = [];
  Object.defineProperty(navigator,'clipboard',{value:{writeText:async value => window.markdownCopies.push(value)},configurable:true});
});
const output = '/tmp/aibo-markdown';
await mkdir(output,{recursive:true});
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
  for (const kit of ['ak-ui','material3']) for (const theme of ['light','dark']) {
    await page.evaluate(({kit,theme}) => localStorage.setItem('aibo.appearance.v1',JSON.stringify({kitId:kit,themeId:theme})),{kit,theme});
    await page.reload();
    const message = page.locator('.assistant-entry .markdown-content').first();
    await message.locator('h6').waitFor();
    assert.equal(await page.locator('.app-shell').getAttribute('data-ui-kit'),kit);
    assert.equal(await message.locator('ol').first().getAttribute('start'),'3');
    assert.equal(await message.locator('ol ul li').count(),2);
    assert.equal(await message.locator('.markdown-task-check').count(),2);
    assert.equal(await message.locator('blockquote ol').count(),1);
    assert.equal(await message.locator('table th').count(),3);
    assert.equal(await message.locator('table th').nth(1).evaluate(element => getComputedStyle(element).textAlign),'center');
    assert.equal(await message.locator('table th').nth(2).evaluate(element => getComputedStyle(element).textAlign),'right');
    assert.equal(await message.locator('strong code').textContent(),'代码');
    assert.equal(await message.locator('em').textContent(),'嵌套说明');
    assert.equal(await message.locator('del').textContent(),'过时建议');
    assert.ok(await message.locator('.hljs-keyword').count());
    assert.ok(!(await message.textContent()).includes('[x]'));
    assert.ok(!(await message.textContent()).includes('[ ]'));
    const tokenColors = await message.locator('pre').evaluate(element => ['.hljs-keyword','.hljs-string','.hljs-number'].map(selector => getComputedStyle(element.querySelector(selector)).color));
    assert.equal(new Set(tokenColors).size,3,'syntax categories use distinct theme colors');
    assert.equal(await message.locator('script').count(),0);
    assert.equal(await page.evaluate(() => window.markdownInjected),undefined);
    assert.equal(await message.locator('a[href^="javascript"]').count(),0);
    const code = await message.locator('pre code').textContent();
    await message.getByRole('button',{name:'复制',exact:true}).click();
    assert.equal(await page.evaluate(() => window.markdownCopies.at(-1)),code);
    const table = message.locator('.markdown-table-scroll');
    await page.keyboard.press('Tab');
    await table.focus();
    assert.equal(await table.evaluate(element => document.activeElement === element),true);
    assert.notEqual(await table.evaluate(element => getComputedStyle(element).outlineStyle),'none');
    await message.locator('h1').scrollIntoViewIfNeeded();
    await page.screenshot({path:`${output}/${kit}-${theme}.png`});
    await page.setViewportSize({width:800,height:900});
    await message.locator('table').scrollIntoViewIfNeeded();
    assert.ok(await table.evaluate(element => element.scrollWidth > element.clientWidth));
    await table.focus();
    await table.press('ArrowRight');
    await page.waitForFunction(() => document.querySelector('.assistant-entry .markdown-table-scroll').scrollLeft > 0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1));
    await page.screenshot({path:`${output}/${kit}-${theme}-narrow.png`});
    await page.setViewportSize({width:1280,height:900});
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: GFM structure, theme styles, syntax highlighting, exact copy, safe text, keyboard focus and narrow windows in ak-ui / Material 3 light and dark.');
} finally { await browser.close(); await server.close(); }
