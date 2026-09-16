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
  const matrix=page.frameLocator('#replaceable .external-control:not(.status-mark):not([hidden]) iframe');
  await matrix.getByRole('button',{name:'High',exact:true}).click();
  await page.waitForFunction(count=>window.controlPackageProbe.result().length===count,count+1);count++;
  assert.deepEqual(await page.evaluate(()=>window.controlPackageProbe.result().at(-1)),['model-a','high']);
  await page.evaluate(()=>window.controlPackageProbe.setDisabled(true));
  await matrix.getByRole('button',{name:'High',exact:true}).evaluate(element=>new Promise(resolve=>{const check=()=>element.disabled?resolve():requestAnimationFrame(check);check()}));
  const mark=page.frameLocator('#replaceable .status-mark:not([hidden]) iframe');
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
  assert.equal(await page.locator('#replaceable .status-mark iframe').getAttribute('tabindex'),'-1');
  await page.getByRole('button',{name:'Select row'}).click();
  assert.deepEqual(await page.evaluate(()=>window.controlPackageProbe.result().at(-1)),['row']);count++;
  assert.equal(await page.locator('#trusted iframe').count(),0);
 }
 await page.evaluate(()=>window.controlPackageProbe.dispose());assert.equal(await page.locator('iframe').count(),0);assert.deepEqual(errors,[]);
 const result={passed:true,browser:browser.version(),nativePort:'not exercised',checks:['independent packages preserve exact OpenAI and Pi paths','all five state tones','reduced-motion disables running animation','model selection calls host and disabled blocks selection','decorative iframe does not capture parent clicks or tab focus','trusted host controls untouched','dispose removes all external controls']};
 await writeFile('/tmp/aibo-presentation-skin-controls-browser.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
} finally {await browser.close();await server.close();await built.dispose();}
