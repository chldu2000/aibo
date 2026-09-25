import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {installDensityFixture} from './lib/density-fixture.mjs';

const server=await createServer({server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false,watch:null}});
await server.listen();
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:960}});
const output='/tmp/aibo-material3-records';
await mkdir(output,{recursive:true});
const errors=[];page.on('pageerror',error=>errors.push(error.message));
const borders=locator=>locator.evaluateAll(elements=>elements.map(element=>{
  const s=getComputedStyle(element);return ['Top','Right','Bottom','Left'].map(side=>s[`border${side}Width`]);
}));
try {
  await page.addInitScript(installDensityFixture);
  await page.addInitScript(()=>{
    localStorage.setItem('aibo.appearance.v1',JSON.stringify({kitId:'material3',themeId:'light'}));
    const original=window.__TAURI_INTERNALS__.invoke;
    window.__TAURI_INTERNALS__.invoke=async(command,args)=>{
      if(command==='get_timeline')return [
        {id:'reason',role:'system',toolName:'reasoning',content:'检查完整的圆角边框。',status:'completed'},
        {id:'read',role:'tool',toolName:'read',content:'src/lib/ui-kit/kits/material3.css',status:'completed'},
        {id:'reply',role:'assistant',content:'继续检查执行结果。',status:'completed'},
        {id:'failed',role:'tool',toolName:'test',content:'Test failed: sample output',status:'failed'},
        {id:'stopped',role:'tool',toolName:'build',content:'Build interrupted',status:'interrupted'},
      ].map(item=>({...item,sessionId:'s1',turnId:'turn',entryType:item.role==='tool'?'tool_result':'message',createdAt:'2026-09-22T14:33:01Z',updatedAt:'2026-09-22T14:33:01.427Z'}));
      return original(command,args);
    };
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  await page.locator('.workspace-item').waitFor();
  if(await page.locator('.workspace-item').getAttribute('aria-expanded')!=='true')await page.locator('.workspace-item').click();
  await page.locator('.session-item').click();
  for(const theme of ['light','dark']) {
    if(await page.locator('.app-shell').getAttribute('data-ui-theme')!==theme)await page.getByRole('button',{name:'切换明暗主题',exact:true}).click();
    await page.locator('#session-tab-conversation').click();
    const cards=page.locator('.timeline-entry:is(.compact-record,.tool-group-entry)');
    await cards.first().waitFor();
    assert.equal(await cards.count(),3,'reasoning, single tool and grouped tools are all present');
    for(const widths of await borders(cards))assert.deepEqual(widths,['1px','1px','1px','1px']);
    for(const radius of await cards.evaluateAll(es=>es.map(e=>getComputedStyle(e).borderTopLeftRadius)))assert.equal(radius,'12px');
    await page.screenshot({path:`${output}/cards-${theme}.png`});
    const disclosure=cards.first().locator('details');
    await disclosure.locator(':scope > summary').click();
    assert.equal(await disclosure.getAttribute('open'),'');
    await disclosure.locator(':scope > summary').click();
    await page.getByRole('tab',{name:'执行记录',exact:true}).click();
    const table=page.getByRole('table',{name:'执行记录',exact:true});
    assert.equal(await table.getByRole('columnheader').count(),4);
    assert.equal(await table.evaluate(e=>getComputedStyle(e).borderTopLeftRadius),'12px');
    assert.equal(await table.evaluate(e=>getComputedStyle(e).borderCollapse),'separate');
    for(const status of await table.locator('.execution-status').evaluateAll(es=>es.map(e=>{const s=getComputedStyle(e);return [s.borderWidth,s.borderRadius,s.backgroundColor]}))) {
      assert.equal(status[0],'0px');assert.equal(status[1],'50%');assert.notEqual(status[2],'rgba(0, 0, 0, 0)');
    }
    const toggle=table.locator('.execution-toggle').first();
    await toggle.focus();await page.keyboard.press('Enter');
    assert.equal(await toggle.getAttribute('aria-expanded'),'true');
    await table.locator('.execution-detail:not([hidden]) pre').waitFor();
    await table.screenshot({path:`${output}/executions-${theme}.png`});
    await toggle.click();
    await page.locator('#session-tab-changes').click();
    const files=page.locator('.session-change-row');await files.first().waitFor();
    assert((await files.count())>=2);
    for(const widths of await borders(files))assert.deepEqual(widths,['0px','0px','0px','0px']);
    await page.locator('#session-panel-changes').screenshot({path:`${output}/changes-${theme}.png`});
    await page.getByRole('tab',{name:'Git',exact:true}).click();
    await page.getByRole('button',{name:'选择仓库',exact:true}).click();
    await page.getByRole('option',{name:/^aibo/}).click();
    await page.locator('#git-history-tab').click();
    const commit=page.locator('.git-history-item').first();
    if(await commit.getAttribute('aria-expanded')!=='true')await commit.click();
    const commitFiles=page.locator('.git-commit-file');await commitFiles.first().waitFor();
    assert((await commitFiles.count())>=2);
    for(const widths of await borders(commitFiles))assert.deepEqual(widths,['0px','0px','0px','0px']);
    await page.locator('.git-history').screenshot({path:`${output}/history-${theme}.png`});
    await commitFiles.first().click();
    await page.waitForFunction(()=>window.densityCalls.some(c=>c.command==='get_workspace_git_commit_file_diff'));
    await page.getByText('history-preview',{exact:true}).waitFor();
    await page.getByRole('button',{name:'关闭文件差异预览',exact:true}).click();
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: Material 3 reasoning/tool card outlines, rounded execution table and status, keyboard disclosure, borderless session/commit file rows and commit diff actions in both themes.');
} catch(error) {await page.screenshot({path:`${output}/failure.png`});throw error;}
finally {await browser.close();await server.close();}
