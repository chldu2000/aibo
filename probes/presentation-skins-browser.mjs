import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {buildPresentationSkins} from './lib/build-presentation-skins.mjs';
const built=await buildPresentationSkins();
const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false,watch:null}});await server.listen();
const browser=await chromium.launch({headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/probes/presentation-semantic.html`);
  await page.waitForFunction(()=>window.semanticPackageProbe);
  const detail=JSON.parse(await readFile('fixtures/semantic-git/detail.json','utf8'));
  const collection=JSON.parse(await readFile('fixtures/semantic-git/collection.json','utf8'));
  let count=0;
  for(const pkg of built.packages) {
    await page.evaluate(snapshot=>window.semanticPackageProbe.update(snapshot),detail);
    await page.evaluate(value=>window.semanticPackageProbe.select(value),pkg);
    const frame=page.frameLocator('.external-semantic iframe');
    await frame.getByRole('heading',{name:detail.contribution.title,exact:true}).waitFor();
    assert.equal(await frame.getByLabel('内容').textContent(),detail.view.content);
    const expected=pkg.release.manifest.themes.find(theme=>theme.id===pkg.release.manifest.defaultThemeId).tokens['--foreground'];
    const color=await frame.locator('body').evaluate(element=>({token:getComputedStyle(element).getPropertyValue('--foreground').trim(),color:getComputedStyle(element).color}));
    assert.equal(color.token,expected);assert.notEqual(color.color,'rgb(0, 0, 0)');
    const first=detail.actions.find(action=>action.enabled);
    await frame.getByRole('button',{name:first.label,exact:true}).click();
    await page.waitForFunction(count=>window.semanticPackageProbe.result().length===count,count+1);count++;
    assert.deepEqual(await page.evaluate(()=>window.semanticPackageProbe.result().at(-1).context),detail.context);
    await page.evaluate(snapshot=>window.semanticPackageProbe.update(snapshot),collection);
    await frame.getByText(collection.view.items[0].values[collection.view.properties[0].key],{exact:true}).waitFor();
    const inspect=collection.actions.find(action=>action.id==='inspect'||action.id==='open-diff');
    await frame.getByRole('button',{name:inspect.label,exact:true}).first().click();
    await page.waitForFunction(count=>window.semanticPackageProbe.result().length===count,count+1);count++;
    assert.equal(await page.evaluate(()=>window.semanticPackageProbe.result().at(-1).itemId),collection.view.items[0].id);
    for(const theme of pkg.release.manifest.themes) {
      await page.evaluate(({pkg,id})=>window.semanticPackageProbe.select(pkg,id),{pkg,id:theme.id});
      await frame.getByRole('heading',{name:collection.contribution.title,exact:true}).waitFor();
      assert.equal(await frame.locator('body').evaluate(element=>getComputedStyle(element).getPropertyValue('--foreground').trim()),theme.tokens['--foreground']);
    }
    await page.evaluate(value=>window.semanticPackageProbe.select(value),pkg);
    await frame.getByRole('heading',{name:collection.contribution.title,exact:true}).waitFor();
    await page.screenshot({path:`/tmp/aibo-${pkg.release.manifest.id.split('.').at(-1)}-semantic.png`,fullPage:true});
  }
  await page.evaluate(()=>window.semanticPackageProbe.dispose());
  assert.equal(await page.locator('.external-semantic iframe').count(),0);
  assert.deepEqual(errors,[]);
  const result={passed:true,browser:browser.version(),nativePort:'not exercised; actual PresentationHost and Worker',checks:['both skin packages built from tarballs outside repo','four-kind and controls activation preflights','all eight theme selections and default theme colors','full detail content','host action context and collection item identity','switch between independent skins','dispose restores default']};
  await writeFile('/tmp/aibo-presentation-skins-browser.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{await browser.close();await server.close();await built.dispose();}
