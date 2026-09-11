import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const output=process.env.AIBO_SEMANTIC_SCREENSHOTS ?? '/tmp/aibo-p1-screenshots';
await mkdir(output,{recursive:true});
const server=await createServer({server:{host:'127.0.0.1',port:0}});await server.listen();
const address=server.httpServer.address();
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1280,height:900},reducedMotion:'reduce'});
const errors=[];page.on('pageerror',error=>errors.push(String(error)));
const evidence=[];
try {
  await page.goto(`http://127.0.0.1:${address.port}/probes/semantic-ui.html`);
  await page.waitForFunction(()=>Boolean(window.semanticProbe));
  let expected;
  for(const kit of ['shadcn','material3'])for(const layout of ['central','sidebar']) {
    await page.evaluate(async({kit,layout})=>window.semanticProbe.mount('svelte',kit,layout),{kit,layout});
    const button=page.getByRole('button',{name:'查看差异 src/App.svelte',exact:true});
    await button.focus();await page.keyboard.press('Enter');
    const action=await page.evaluate(()=>window.semanticProbe.actions.at(-1));
    expected??=action;assert.deepEqual(action,expected);
    assert.equal(await page.getByRole('button',{name:'上一页',exact:true}).isDisabled(),true);
    await page.screenshot({path:`${output}/${kit}-${layout}.png`,fullPage:true});
    await page.evaluate(()=>window.semanticProbe.update('detail'));
    await page.waitForFunction(()=>document.activeElement?.tagName==='H2');
    await page.getByRole('button',{name:'返回变更列表',exact:true}).focus();await page.keyboard.press('Space');
    assert.equal((await page.evaluate(()=>window.semanticProbe.actions.at(-1))).actionId,'back');
    await page.evaluate(()=>window.semanticProbe.update('collection'));
    await page.waitForFunction(()=>document.activeElement?.getAttribute('data-item')==='worktree:src/App.svelte');
    for(const fixture of ['empty','error','loading','unavailable','partial','partialDetail']) {
      await page.evaluate(fixture=>window.semanticProbe.update(fixture),fixture);
      if(fixture==='error')assert.match(await page.getByRole('alert').innerText(),/失败/);
      if(fixture==='loading')assert.equal(await page.getByRole('button',{name:'刷新',exact:true}).isDisabled(),true);
      if(fixture==='partial')assert.match(await page.locator('#probe').innerText(),/部分结果/);
      if(fixture==='partialDetail')assert.match(await page.locator('#probe').innerText(),/截断/);
    }
    evidence.push({renderer:'svelte',kit,layout,keyboard:'Enter/Space',focus:'detail and return',states:'passed',screenshot:`${kit}-${layout}.png`});
  }
  await page.evaluate(()=>window.semanticProbe.mount('dom'));
  await page.getByRole('button',{name:/查看差异 文件: src\/App.svelte/}).click();
  assert.deepEqual(await page.evaluate(()=>window.semanticProbe.actions.at(-1)),expected);
  await page.evaluate(()=>window.semanticProbe.update('partialDetail'));
  assert.match(await page.locator('#probe').innerText(),/截断/);
  await page.evaluate(()=>window.semanticProbe.dispose());assert.equal(await page.locator('#probe').innerHTML(),'');
  for(const kit of ['shadcn','material3']) {
    await page.evaluate(kit=>window.semanticProbe.workbench(kit),kit);
    await page.getByRole('button',{name:'切换侧栏布局',exact:true}).click();
    await page.getByRole('button',{name:'查看差异 src/App.svelte',exact:true}).click();
    await page.getByRole('textbox',{name:'文件差异内容',exact:true}).waitFor();
    await page.screenshot({path:`${output}/${kit}-workbench-detail.png`,fullPage:true});
    await page.getByRole('button',{name:'返回变更列表',exact:true}).click();
    await page.getByRole('button',{name:'查看差异 src/App.svelte',exact:true}).waitFor();
    await page.getByRole('button',{name:'切换中央布局',exact:true}).click();
    await page.getByRole('table').waitFor();
    await page.getByRole('button',{name:'关闭工作区工具',exact:true}).click();
    assert.equal(await page.locator('#probe').innerHTML(),'');
    evidence.push({kit,workbench:'sidebar detail / return / central / close passed'});
  }
  // Host navigation survives disposal, separates workspaces and validates restored targets.
  await page.evaluate(()=>window.semanticProbe.workbench('shadcn',{persist:true,workspaceId:'restore-a'}));
  await page.getByRole('button',{name:'查看差异 src/App.svelte',exact:true}).click();
  await page.getByRole('textbox',{name:'文件差异内容',exact:true}).waitFor();
  await page.getByRole('button',{name:'切换侧栏布局',exact:true}).click();
  await page.getByRole('button',{name:'关闭工作区工具',exact:true}).click();
  await page.evaluate(()=>window.semanticProbe.workbench('shadcn',{persist:true,workspaceId:'restore-b'}));
  await page.getByRole('table').waitFor();
  assert.equal(await page.getByRole('textbox',{name:'文件差异内容',exact:true}).count(),0);
  await page.getByRole('button',{name:'关闭工作区工具',exact:true}).click();
  await page.evaluate(()=>window.semanticProbe.workbench('shadcn',{persist:true,workspaceId:'restore-a'}));
  await page.getByRole('textbox',{name:'文件差异内容',exact:true}).waitFor();
  await page.getByRole('button',{name:'切换中央布局',exact:true}).waitFor();
  await page.screenshot({path:`${output}/restored-detail.png`,fullPage:true});
  await page.getByRole('button',{name:'关闭工作区工具',exact:true}).click();
  await page.evaluate(()=>window.semanticProbe.workbench('shadcn',{persist:true,workspaceId:'restore-a',missing:true}));
  await page.getByRole('button',{name:'查看差异 new.txt',exact:true}).waitFor();
  assert.equal(await page.getByRole('textbox',{name:'文件差异内容',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'查看差异 src/App.svelte',exact:true}).count(),0);
  await page.getByRole('button',{name:'关闭工作区工具',exact:true}).click();
  evidence.push({recovery:'workspace A/B/A, layout/detail restored after disposal, deleted target returns to collection'});
  assert.deepEqual(errors,[]);evidence.push({renderer:'dom',fixture:'same collection/detail',action:'identical',dispose:'passed'});
  await writeFile(`${output}/results.json`,JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({output,evidence},null,2));
} finally {await browser.close();await server.close();}
