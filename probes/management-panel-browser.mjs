import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false,watch:null}});
await server.listen();let browser;
try {
  browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1100,height:850}});
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/probes/management-panel.html`);
  await page.waitForFunction(()=>Boolean(window.mountManagementProbe));
  for(const kit of ['material3','ak-ui'])for(const theme of ['light','dark']) {
    await page.evaluate(({kit,theme})=>window.mountManagementProbe(kit,theme),{kit,theme});
    const tab=page.getByRole('tab',{name:/Example Agent/});
    await tab.click();await page.getByLabel('First instructions',{exact:true}).fill('First draft');
    await page.getByLabel('Second instructions',{exact:true}).fill('Second draft');
    assert.equal(await page.getByRole('radio',{name:'当前项目',exact:true}).isDisabled(),true);
    assert.equal(await page.getByRole('radio',{name:'当前会话',exact:true}).isDisabled(),true);
    await page.getByRole('tab',{name:/外观/}).click();await tab.click();
    assert.equal(await page.getByLabel('First instructions',{exact:true}).inputValue(),'First draft');
    await page.getByRole('button',{name:'保存设置',exact:true}).nth(1).click();
    await page.waitForFunction(()=>window.managementProbe.saves.length===1);
    assert.equal(await page.evaluate(()=>window.managementProbe.saves[0].values.text),'Second draft');
    assert.equal(await page.getByLabel('First instructions',{exact:true}).inputValue(),'First draft');
    await tab.focus();await page.keyboard.press('Home');assert.equal(await page.getByRole('tab',{name:/外观/}).getAttribute('aria-selected'),'true');
    await page.keyboard.press('End');assert.equal(await tab.getAttribute('aria-selected'),'true');
    const account=page.getByRole('tab',{name:'Account',exact:true});
    const behavior=page.getByRole('tab',{name:'Behavior',exact:true});
    assert.equal(await behavior.getAttribute('aria-selected'),'true');
    await behavior.press('End');assert.equal(await account.getAttribute('aria-selected'),'true');
    assert.equal(await account.evaluate(element=>element===document.activeElement),true);
    assert.equal(await tab.getAttribute('aria-selected'),'true');
    await page.getByText('person@example.test',{exact:true}).waitFor();
    assert.equal(await page.getByText('35%',{exact:true}).count(),1);
    assert.equal(await page.getByRole('meter',{name:'Quota'}).getAttribute('aria-valuenow'),'35');
    await page.screenshot({path:`/tmp/aibo-management-${kit}-${theme}-wide.png`});
    await page.getByRole('button',{name:'刷新',exact:true}).click();
    assert.match(await page.getByRole('alert').innerText(),/无法读取/);
    assert.equal(await page.getByText('person@example.test',{exact:true}).count(),0);
    await page.getByRole('button',{name:'刷新',exact:true}).click();
    await page.getByText('person@example.test',{exact:true}).waitFor();
    await page.setViewportSize({width:700,height:850});
    assert.equal(await page.evaluate(()=>document.querySelector('dialog').scrollWidth<=document.querySelector('dialog').clientWidth+1),true);
    await page.screenshot({path:`/tmp/aibo-management-${kit}-${theme}.png`});
    await page.setViewportSize({width:1100,height:850});console.log(`${kit}/${theme}: navigation, forms, drafts, scopes, dynamic data, failure/retry, keyboard and narrow layout passed`);
  }
  assert.deepEqual(errors,[]);
} finally {await browser?.close();await server.close();}
