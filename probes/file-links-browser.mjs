import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createBuiltinWorkbenchServer} from './lib/builtin-workbench-fixture.mjs';
const server = await createBuiltinWorkbenchServer({markdown:'[代码](src/main.ts:42) · [邮件](mailto:dev@example.com) · [网页](https://example.com)\n\n[空格路径](<file:///workspace/a%20b.ts#L8>)\n\n[不存在](missing.ts) · [二进制](binary.dat)'});
await server.listen();
const browser = await chromium.launch({headless:true});
const page = await browser.newPage({viewport:{width:1280,height:900}});
const errors = []; page.on('pageerror',error => errors.push(error.message));
try {
  await page.addInitScript(() => { if (window === window.top && location.protocol === 'http:') localStorage.setItem('aibo.language.v1','zh-CN'); });
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
  for (const kit of ['ak-ui','material3']) for (const theme of ['light','dark']) {
    await page.evaluate(({kit,theme}) => localStorage.setItem('aibo.appearance.v1',JSON.stringify({kitId:kit,themeId:theme})),{kit,theme});
    await page.reload(); await page.getByRole('link',{name:'代码',exact:true}).waitFor();
    await page.evaluate(() => {
      window.fileReads = []; window.linkOpens = []; window.copiedPaths = [];
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text => window.copiedPaths.push(text)}});
      window.__TAURI_INTERNALS__ = {metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},invoke:async (command,args) => {
        if (command === 'plugin:opener|open_url') { window.linkOpens.push(args.url); return; }
        if (command !== 'read_linked_file') throw Error('unexpected command '+command);
        window.fileReads.push(args);
        if (args.path === 'missing.ts') throw Error('文件不存在');
        if (args.path === 'binary.dat') throw {code:'session_operation_error',message:'session operation failed: 二进制文件不提供文本预览',localized:{schema:'aibo.host-message/v1',key:'native.search.binaryPreview',params:{}}};
        if (window.holdFileRead) await new Promise(resolve => {window.resolveFileRead = resolve;});
        return {path:'/workspace/'+args.path.replace('/workspace/',''),content:Array.from({length:100},(_,i)=>'const value'+(i+1)+' = '+(i+1)+';').join('\n'),startLine:1,totalLines:100,truncated:false,targetLine:args.line ?? 1};
      }};
    });
    const link = page.getByRole('link',{name:'代码',exact:true});
    assert.equal(await link.locator('svg').count(),1);
    assert.match(await link.getAttribute('title'),/本地文件/);
    await link.focus(); await page.keyboard.press('Enter');
    const panel = page.getByRole('complementary',{name:'文件预览',exact:true});
    await panel.locator('[data-line="42"][aria-current="true"]').waitFor();
    assert.deepEqual(await page.evaluate(()=>window.fileReads[0]),{sessionId:'a',path:'src/main.ts',line:42});
    assert.ok(await panel.locator('.hljs-keyword').count());
    const target = await panel.locator('[data-line="42"]').boundingBox();
    const viewport = await panel.locator('pre').boundingBox();
    assert.ok(target.y >= viewport.y && target.y + target.height <= viewport.y + viewport.height,'requested line is visible');
    await panel.getByRole('button',{name:'复制路径',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.copiedPaths.at(-1)),'/workspace/src/main.ts');
    await page.keyboard.press('Escape'); await panel.waitFor({state:'hidden'});
    assert.equal(await link.evaluate(node=>node===document.activeElement),true);
    await page.getByRole('link',{name:'空格路径',exact:true}).click();
    await panel.locator('[data-line="8"][aria-current="true"]').waitFor();
    await panel.getByRole('button',{name:'关闭文件预览'}).click();
    await page.getByRole('link',{name:'不存在',exact:true}).click();
    await panel.getByRole('alert').filter({hasText:'文件不存在'}).waitFor();
    await panel.getByRole('button',{name:'关闭文件预览'}).click();
    await page.getByRole('link',{name:'二进制',exact:true}).click();
    await panel.getByRole('alert').filter({hasText:'二进制文件不提供文本预览'}).waitFor();
    const readsBeforeLanguage = await page.evaluate(()=>window.fileReads.length);
    await page.evaluate(async()=>{const {language}=await import('/src/lib/i18n/runtime.ts');language.set({preference:'en',locale:'en'});});
    const englishPanel = page.getByRole('complementary',{name:'File preview',exact:true});
    await englishPanel.getByRole('alert').filter({hasText:'Text previews are unavailable for binary files.'}).waitFor();
    await page.evaluate(async()=>{const {language}=await import('/src/lib/i18n/runtime.ts');language.set({preference:'zh-CN',locale:'zh-CN'});});
    await panel.getByRole('alert').filter({hasText:'二进制文件不提供文本预览'}).waitFor();
    assert.equal(await page.evaluate(()=>window.fileReads.length),readsBeforeLanguage,'language changes do not read the file again');
    await panel.getByRole('button',{name:'关闭文件预览'}).click();
    await page.evaluate(()=>{window.holdFileRead=true;}); await link.click();
    await panel.getByRole('status').filter({hasText:'正在读取'}).waitFor();
    await panel.getByRole('button',{name:'关闭文件预览'}).click();
    await page.evaluate(()=>{window.resolveFileRead();window.holdFileRead=false;});
    await page.waitForTimeout(100); assert.equal(await panel.count(),0);
    await page.getByRole('link',{name:'邮件',exact:true}).click();
    await page.getByRole('link',{name:'网页',exact:true}).click();
    assert.deepEqual(await page.evaluate(()=>window.linkOpens),['mailto:dev@example.com','https://example.com']);
    await page.setViewportSize({width:800,height:700}); await link.click();
    await panel.locator('[data-line="42"]').waitFor();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:`/tmp/aibo-file-preview-${kit}-${theme}.png`});
    await panel.getByRole('button',{name:'关闭文件预览'}).click();
    await page.setViewportSize({width:1280,height:900});
    await link.click(); await panel.locator('[data-line="42"]').waitFor();
    await page.getByText('完善会话恢复测试',{exact:true}).click();
    await panel.waitFor({state:'hidden'});
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: local link icons, session-scoped reads, line focus, syntax, path copy, errors, close races, external URLs and narrow preview in both kits/light-dark');
} finally {await browser.close();await server.close();}
