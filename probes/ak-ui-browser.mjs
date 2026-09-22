import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

// Fixture data enters App's preview path; the shipped UI, state controllers and
// event handlers remain real. No Agent or native command is executed here.
const server = await createServer({server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false,watch:null},plugins:[{
  name:'ak-ui-preview-data',enforce:'pre',transform(code,id){
    if(!id.endsWith('/src/App.svelte'))return;
    return code.replace('workspaces = previewWorkspaces;', `workspaces = previewWorkspaces.map(item => ({...item,label:'aibo-dev',trust:'trusted'}));
      workspaceSessionMap = { 'preview-workspace': ['a','b'].map((id,index)=>({
        id,workspaceId:'preview-workspace',agent:'third.party.agent',label:index?'完善会话恢复测试':'重构默认视觉体验',
        state:'idle',archived:false,externalSessionId:null,pluginInstallationId:'fixture',capabilities:[],createdAt:'2026-09-22',updatedAt:'2026-09-22'
      }))};
      setTimeout(()=>{selectedSessionId='a';sidePanelView='context';},100);
      setTimeout(()=>{timeline=[
        {id:'u1',sessionId:'a',turnId:'turn',role:'user',entryType:'message',content:'使用 ak-ui 改造 Aibo 的默认界面。导航和工作区在同一主题下统一明暗，保留会话与代码变更的工作流。',status:'completed',createdAt:'2026-09-22T14:32:00Z'},
        {id:'a1',sessionId:'a',turnId:'turn',role:'assistant',entryType:'message',content:'## 让复杂的工作，拥有清晰的界面。\\n\\n默认工作台现在使用一套一致的视觉语言。\\n\\n1. **统一视觉层级**：浅色与深色主题保持一致。\\n2. **为内容留出空间**：对话、代码与操作各有清晰的优先级。\\n3. **保留完整工作流**：会话、工具调用、审批和插件仍由宿主管理。',status:'completed',createdAt:'2026-09-22T14:33:00Z'},
        {id:'t1',sessionId:'a',turnId:'turn',role:'tool',entryType:'tool_result',toolName:'read',content:'src/lib/ui-kit/contract.ts\\nsrc/lib/ui-kit/registry.ts',status:'completed',createdAt:'2026-09-22T14:33:01Z'}
      ];},350);`);
  }
}]});
await server.listen();
const browser=await chromium.launch({headless:true});
const output=process.env.AIBO_PROBE_OUTPUT??'/tmp/aibo-ak-ui';await mkdir(output,{recursive:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:960}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  if(!localStorage.getItem('aibo.appearance.v1'))localStorage.setItem('aibo.appearance.v1',JSON.stringify({kitId:'material3',themeId:'daylight'}));
  localStorage.setItem('probe.unrelated.draft','保留我的草稿');
 });
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
 await page.locator('.assistant-entry').waitFor();
 assert.equal(await page.locator('.app-shell').getAttribute('data-ui-kit'),'ak-ui');
 assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('aibo.appearance.v1'))),{kitId:'ak-ui',themeId:'light'});
 assert.equal(await page.evaluate(()=>localStorage.getItem('probe.unrelated.draft')),'保留我的草稿');
 assert.equal(await page.locator('.sidebar-new-session').count(),1);
 assert.equal(await page.locator('.sidebar .brand').count(),0);
 const input=page.locator('[data-composer-input]');await input.fill('主题切换时保留这段草稿');
 for(const mode of ['light','dark']){
  if(await page.locator('.app-shell').getAttribute('data-ui-theme')!==mode)await page.getByRole('button',{name:'切换明暗主题',exact:true}).click();
  assert.equal(await input.inputValue(),'主题切换时保留这段草稿');
  const backgrounds=await page.locator('.sidebar,.timeline,.inspector').evaluateAll(nodes=>nodes.map(n=>getComputedStyle(n).backgroundColor));
  for(const bg of backgrounds){const rgb=bg.match(/[\d.]+/g).slice(0,3).map(Number);assert.equal(rgb.every(c=>c>200),mode==='light',bg)}
  await page.screenshot({path:`${output}/desktop-${mode}.png`});
 }
 await page.getByRole('button',{name:'工作台设置',exact:true}).click();
 await page.getByRole('dialog',{name:'管理中心',exact:true}).waitFor();
 assert.equal(await page.locator('.appearance-kit-option').count(),1);
 assert.equal(await page.locator('.appearance-theme-option').count(),2);
 await page.locator('.appearance-theme-option').filter({hasText:'浅色'}).click();
 await page.screenshot({path:`${output}/settings-light.png`});
 await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog',{name:'管理中心',exact:true}).count(),0);
 await page.locator('.sidebar-footer button:focus').waitFor();
 assert.equal(await page.getByRole('button',{name:'工作台设置',exact:true}).evaluate(e=>e===document.activeElement),true);
 assert.equal(await input.inputValue(),'主题切换时保留这段草稿');
 await page.getByRole('button',{name:'新建会话',exact:true}).click();
 await page.getByRole('group',{name:'选择 Agent 创建会话'}).waitFor();
 await page.getByRole('button',{name:'关闭 Agent 选择',exact:true}).click();
 assert.equal(await page.getByRole('button',{name:'新建会话',exact:true}).evaluate(e=>e===document.activeElement),true);
 await page.getByRole('button',{name:'新建会话',exact:true}).click();
 await page.getByRole('group',{name:'选择 Agent 创建会话'}).waitFor();
 await page.keyboard.press('Escape');
 assert.equal(await page.getByRole('group',{name:'选择 Agent 创建会话'}).count(),0);
 assert.equal(await page.getByRole('button',{name:'新建会话',exact:true}).evaluate(e=>e===document.activeElement),true);
 await page.getByRole('button',{name:'专注会话',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('[data-presentation-layout="focus"][aria-busy="false"]'));
 assert.equal(await input.inputValue(),'主题切换时保留这段草稿');
 await page.keyboard.press('Control+Shift+Backspace');
 await page.waitForFunction(()=>document.querySelector('[data-presentation-layout="standard"][aria-busy="false"]'));
 await page.setViewportSize({width:390,height:844});
 for(const mode of ['light','dark']){
  if(await page.locator('.app-shell').getAttribute('data-ui-theme')!==mode)await page.getByRole('button',{name:'切换明暗主题',exact:true}).click();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert(await input.isVisible());
  assert((await input.boundingBox()).width>250);
  await page.screenshot({path:`${output}/mobile-${mode}.png`});
 }
 const regions=page.getByRole('navigation',{name:'工作台区域'});
 await regions.getByRole('button',{name:'工作区',exact:true}).click();assert(await page.locator('.sidebar-new-session').isVisible());
 await regions.getByRole('button',{name:'侧边栏',exact:true}).click();assert(await page.locator('.inspector').isVisible());
 await regions.getByRole('button',{name:'会话',exact:true}).click();assert(await input.isVisible());
 await page.emulateMedia({reducedMotion:'reduce'});
 assert(await page.locator('.sidebar-new-session').evaluate(e=>parseFloat(getComputedStyle(e).transitionDuration)<.001));
 assert.deepEqual(errors,[]);
 console.log('PASS: actual App themes/migration, draft preservation, settings/native focus, provider chooser, layout recovery, responsive regions, reduced motion and clean browser console.');
}finally{await browser.close();await server.close()}
