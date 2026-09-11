import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
const output = process.env.AIBO_MANIFEST_EVIDENCE ?? '/tmp/aibo-p3-manifest';
await mkdir(output, {recursive:true});
const server = await createServer({ server:{host:'127.0.0.1',port:0,hmr:false,watch:null} });
await server.listen();
const browser = await chromium.launch({headless:true});
const page = await browser.newPage({viewport:{width:1100,height:900}});
const errors=[],results=[];page.on('pageerror',error=>errors.push(String(error)));
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/probes/plugin-manifest.html`);
  await page.waitForFunction(()=>Boolean(window.manifestProbe));
  for(const kit of ['shadcn','material3']) {
    await page.evaluate(kit=>window.manifestProbe.render(kit),kit);
    await page.getByText('插件已登记；此版本尚未支持 inspector 语义类型。',{exact:true}).waitFor();
    assert.equal(await page.getByLabel('Git changes contribution',{exact:true}).getByRole('button',{name:'启用插件',exact:true}).isDisabled(),true);
    assert.equal(await page.getByRole('button',{name:'新建 Echo Agent 会话',exact:true}).isEnabled(),true);
    await page.getByText(/可选依赖不可用，相关功能已停用/).waitFor();
    assert.equal(await page.getByLabel('Capability Parent',{exact:true}).getByRole('button',{name:'启用插件',exact:true}).isEnabled(),true);
    await page.getByRole('button',{name:'新建 Echo Agent 会话',exact:true}).click();
    assert.deepEqual(await page.evaluate(()=>window.manifestProbe.calls.at(-1)),['create','echo','dev.aibo.echo.agent']);
    await page.getByRole('button',{name:'卸载插件',exact:true}).first().click();
    assert.deepEqual(await page.evaluate(()=>window.manifestProbe.calls.at(-1)),['uninstall','view']);
    await page.screenshot({path:`${output}/${kit}.png`});
    results.push({kit,declarativeWithoutAgents:true,activationReasonVisible:true,enableBlocked:true,v1CreationPreserved:true,uninstallAvailable:true,optionalDependencyDiagnostic:true,unrelatedFeaturesEnableable:true});
  }
  assert.deepEqual(errors,[]);
  await writeFile(`${output}/results.json`,JSON.stringify(results,null,2)+'\n');
  console.log(JSON.stringify(results));
} finally {await browser.close();await server.close();}
