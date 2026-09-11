import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const server = await createServer({server:{host:'127.0.0.1',port:0,hmr:false,watch:null}}); await server.listen();
const browser = await chromium.launch({headless:true}), results = [];
try {
 for (const kit of ['shadcn','material3']) {
  const page = await browser.newPage({viewport:{width:1440,height:1000}});
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  await page.evaluate(async kit => (await import('/src/lib/ui-kit/registry.ts')).setUiKit(kit), kit);
  await page.getByRole('button',{name:'恢复默认呈现',exact:true}).waitFor();
  const client = await page.context().newCDPSession(page);
  const layouts = [];
  for (const layout of ['standard','review','focus']) {
   if (layout === 'review') await page.getByRole('button',{name:'交换工作台侧边区域',exact:true}).click();
   if (layout === 'focus') await page.getByRole('button',{name:'切换工作台呈现',exact:true}).click();
   await page.waitForFunction(layout => document.querySelector('[data-presentation-layout]')?.dataset.presentationLayout === layout, layout);
   const {nodes} = await client.send('Accessibility.getFullAXTree');
   const exposed = nodes.filter(node => !node.ignored);
   const roles = new Set(['button','textbox','combobox','checkbox','radio','switch','slider','spinbutton','link','tab']);
   const controls = exposed.filter(node => roles.has(node.role?.value));
   const unnamed = controls.filter(node => !node.name?.value?.trim()).map(node => ({role:node.role.value,backendDOMNodeId:node.backendDOMNodeId}));
   assert.deepEqual(unnamed, [], `${kit}/${layout}: unnamed controls`);
   assert.ok(controls.some(node => node.name.value === '恢复默认呈现'), 'host recovery remains exposed');
   assert.equal(exposed.filter(node => node.role?.value === 'main').length, 1, 'one main landmark');
   layouts.push({layout,namedControls:controls.length,hostRecovery:true,mainLandmark:true});
  }
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/probes/semantic-ui.html`);
  await page.waitForFunction(() => window.semanticProbe);
  const semantics = [];
  for (const fixture of ['collection','detail','stableSettings','stableInspector']) {
   await page.evaluate(async ({kit,fixture}) => window.semanticProbe.mount('svelte',kit,'central',fixture), {kit,fixture});
   const {nodes} = await client.send('Accessibility.getFullAXTree');
   const exposed = nodes.filter(node => !node.ignored);
   const controls = exposed.filter(node => ['button','textbox'].includes(node.role?.value));
   assert.ok(controls.length > 0 && controls.some(node => node.name?.value === '刷新'));
   assert.deepEqual(controls.filter(node => !node.name?.value?.trim()), []);
   if (fixture !== 'collection') {
    const textboxes = controls.filter(node => node.role.value === 'textbox');
    assert.equal(textboxes.length, 1);
    assert.equal(textboxes[0].properties?.find(property => property.name === 'readonly')?.value?.value, true);
   }
   semantics.push({fixture,namedControls:controls.length,readOnlyExposed:fixture !== 'collection'});
  }
  await page.evaluate(() => window.semanticProbe.update('error'));
  const errorTree = await client.send('Accessibility.getFullAXTree');
  assert.ok(errorTree.nodes.some(node => !node.ignored && node.role?.value === 'alert'), 'semantic error is exposed as an alert');
  results.push({kit,layouts,semantics,errorAlert:true}); await page.close();
 }
 await writeFile('/tmp/aibo-p4-workbench-accessibility.json',JSON.stringify({results},null,2)+'\n'); console.log(JSON.stringify({results}));
} finally { await browser.close(); await server.close(); }
