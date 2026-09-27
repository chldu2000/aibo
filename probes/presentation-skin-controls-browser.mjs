import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {buildPresentationSkins} from './lib/build-presentation-skins.mjs';
const built=await buildPresentationSkins({surfaces:'controls,semantic'});
const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false,watch:null}});await server.listen();
const browser=await chromium.launch({headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
try {
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/probes/presentation-controls.html`);await page.waitForFunction(()=>window.controlPackageProbe);
 let count=0;
 for(const pkg of built.packages) {
  await page.evaluate(()=>window.controlPackageProbe.setDisabled(false));
  await page.evaluate(pkg=>window.controlPackageProbe.select(pkg),pkg);
  const matrix=page.frameLocator('#replaceable > .external-control:not([hidden]) iframe');
  await matrix.getByRole('button',{name:'High',exact:true}).click();
  await page.waitForFunction(count=>window.controlPackageProbe.result().length===count,count+1);count++;
  assert.deepEqual(await page.evaluate(()=>window.controlPackageProbe.result().at(-1)),['model-a','high']);
  await page.evaluate(()=>window.controlPackageProbe.setDisabled(true));
  await matrix.getByRole('button',{name:'High',exact:true}).evaluate(element=>new Promise(resolve=>{const check=()=>element.disabled?resolve():requestAnimationFrame(check);check()}));
  const mark=page.frameLocator('#replaceable button .status-mark:not([hidden]) iframe');
  for(const agent of ['codex','pi']) {
   const expected=JSON.parse(await readFile(`src-tauri/capability-plugins/${agent}/plugin.json`,'utf8')).contributions[0].icon.path;
   for(const tone of ['idle','running','attention','danger','muted']) {
    await page.evaluate(({agent,tone})=>window.controlPackageProbe.setMark(agent,tone),{agent,tone});
    await mark.locator('.status.'+tone).waitFor();
    assert.equal(await mark.locator('svg path').getAttribute('d'),expected);
    if(tone==='running') {
     await page.emulateMedia({reducedMotion:'reduce'});
     assert.equal(await mark.locator('.status>span').first().evaluate(el=>getComputedStyle(el).animationName),'none');
     await page.emulateMedia({reducedMotion:'no-preference'});
     assert.equal(await mark.locator('.status>span').first().evaluate(el=>getComputedStyle(el).animationName),'status-orbit');
    }
   }
  }
  assert.equal(await page.locator('#replaceable button .status-mark iframe').getAttribute('tabindex'),'-1');
  await page.getByRole('button',{name:'Select row'}).click();
  assert.deepEqual(await page.evaluate(()=>window.controlPackageProbe.result().at(-1)),['row']);count++;
  assert.equal(await page.locator('#trusted iframe').count(),0);
  // Host API 1.1.0: file and session marks, and select triggers with host-drawn menus.
  const marks=page.locator('#marks .external-control:not([hidden]) iframe');
  await page.waitForFunction(()=>document.querySelectorAll('#marks .external-control:not([hidden]) iframe').length===3);
  assert.equal(await marks.nth(0).contentFrame().locator('.file-change.conflicted').getAttribute('title'),'合并冲突');
  assert.equal(await marks.nth(0).contentFrame().locator('.file-change').textContent(),'U');
  assert.equal(await marks.nth(1).contentFrame().locator('.file-change.added').count(),1);
  assert.equal(await marks.nth(2).contentFrame().locator('.session-control.plan svg path').count(),1);
  const selects=page.locator('#selects .external-control:not([hidden]) iframe');
  await page.waitForFunction(()=>document.querySelectorAll('#selects .external-control:not([hidden]) iframe').length===2);
  const select=selects.nth(0).contentFrame(),context=selects.nth(1).contentFrame();
  await select.getByRole('button',{name:'Probe select：Alpha'}).waitFor();
  await context.getByRole('button',{name:'模型上下文大小：272K'}).waitFor();
  await page.locator('#probe').screenshot({path:`/tmp/aibo-skin-controls-${pkg.release.manifest.id.split('.').at(-1)}.png`});
  await select.getByRole('button',{name:'Probe select：Alpha'}).click();
  const listbox=page.getByRole('listbox',{name:'Probe select'});await listbox.waitFor();
  await listbox.getByRole('option',{name:'Beta'}).click();
  await page.waitForFunction(count=>window.controlPackageProbe.result().length===count,count+1);count++;
  assert.deepEqual(await page.evaluate(()=>window.controlPackageProbe.result().at(-1)),['select','b']);
  await select.getByRole('button',{name:'Probe select：Beta'}).waitFor();
  await context.getByRole('button',{name:'模型上下文大小：272K'}).click();
  await page.getByRole('listbox',{name:'模型上下文大小'}).getByRole('option',{name:'1M'}).click();
  await page.waitForFunction(count=>window.controlPackageProbe.result().length===count,count+1);count++;
  assert.deepEqual(await page.evaluate(()=>window.controlPackageProbe.result().at(-1)),['context','max']);
  await page.evaluate(()=>window.controlPackageProbe.setChoice('a'));
 }
 await page.evaluate(()=>window.controlPackageProbe.dispose());assert.equal(await page.locator('iframe').count(),0);assert.deepEqual(errors,[]);
 const result={passed:true,browser:browser.version(),nativePort:'not exercised',checks:['independent packages preserve exact OpenAI and Pi paths','all five state tones','reduced-motion disables running animation','model selection calls host and disabled blocks selection','decorative iframe does not capture parent clicks or tab focus','trusted host controls untouched','file and session marks render package glyphs with host labels','select and context triggers open host menus and commit choices','dispose removes all external controls']};
 await writeFile('/tmp/aibo-presentation-skin-controls-browser.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
} finally {await browser.close();await server.close();await built.dispose();}
