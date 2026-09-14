import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const server = await createServer({server:{host:'127.0.0.1',port:0,hmr:false,watch:null}});
await server.listen();
const browser = await chromium.launch({headless:true}), results = [];
try {
  for (const kit of ['shadcn','material3']) {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/probes/plugin-management-recovery.html`);
    await page.waitForFunction(() => window.managementRecoveryProbe);
    await page.evaluate(kit => window.managementRecoveryProbe.show(kit), kit);
    assert.match(await page.getByRole('alert').innerText(), /执行依赖不可用/);
    await page.getByRole('button',{name:'禁用插件',exact:true}).click();
    assert.deepEqual(await page.evaluate(() => window.managementRecoveryProbe.actions()), [{type:'enabled',id:'broken-installation',value:false}]);
    // The host supplies the new installation state after completing the request.
    await page.evaluate(kit => window.managementRecoveryProbe.show(kit,false), kit);
    assert.equal(await page.getByRole('button',{name:'启用插件',exact:true}).isDisabled(), true);
    await page.getByRole('button',{name:'卸载插件',exact:true}).click();
    assert.deepEqual(await page.evaluate(() => window.managementRecoveryProbe.actions()), [
      {type:'enabled',id:'broken-installation',value:false}, {type:'uninstall',id:'broken-installation'},
    ]);
    assert.deepEqual(errors, []);
    results.push({kit,diagnosticVisible:true,brokenEnabledPluginCanBeDisabled:true,brokenDisabledPluginCannotBeEnabled:true,uninstallAvailable:true});
    await page.close();
  }
  await writeFile('/tmp/aibo-p4-plugin-management-recovery.json',JSON.stringify({results},null,2)+'\n');
  console.log(JSON.stringify({results}));
} finally { await browser.close(); await server.close(); }
