import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

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
        {id:'t1',sessionId:'a',turnId:'turn',role:'tool',entryType:'tool_result',toolName:'read',content:'src/lib/ui-kit/contract.ts\\nsrc/lib/ui-kit/registry.ts',status:'completed',createdAt:'2026-09-22T14:33:01Z',updatedAt:'2026-09-22T14:33:13.400Z'}
      ];attachments = [{id:'image-fixture',sessionId:'a',turnId:null,path:'clipboard-wide.png',mediaType:'image/png',size:2400,source:'picker',sendStrategy:'inline',createdAt:'now'},{id:'file-fixture',sessionId:'a',turnId:null,path:'pnpm-lock.yaml',mediaType:'text/plain',size:1200,source:'picker',sendStrategy:'reference',createdAt:'now'}];},350);`);
  }
}]});
await server.listen();
const browser=await chromium.launch({headless:true});
const output=process.env.AIBO_PROBE_OUTPUT??'/tmp/aibo-ak-ui';await mkdir(output,{recursive:true});
const contrast=({bg,fg})=>{
 const lum=color=>{const rgb=color.match(/[\d.]+/g).slice(0,3).map(Number).map(n=>n/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722};
 const values=[lum(bg),lum(fg)].sort((a,b)=>b-a);return (values[0]+.05)/(values[1]+.05);
};
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
 const input=page.locator('[data-composer-input]');
 const initialHeight=(await input.boundingBox()).height;
 await input.fill(Array(8).fill('多行草稿').join('\n'));
 assert((await input.boundingBox()).height>initialHeight,'composer grows with multiline input');
 await input.fill('主题切换时保留这段草稿');
 for(const mode of ['light','dark']){
  if(await page.locator('.app-shell').getAttribute('data-ui-theme')!==mode)await page.getByRole('button',{name:'切换明暗主题',exact:true}).click();
  assert.equal(await input.inputValue(),'主题切换时保留这段草稿');
  const backgrounds=await page.locator('.sidebar,.timeline,.inspector').evaluateAll(nodes=>nodes.map(n=>getComputedStyle(n).backgroundColor));
  for(const bg of backgrounds){const rgb=bg.match(/[\d.]+/g).slice(0,3).map(Number);assert.equal(rgb.every(c=>c>200),mode==='light',bg)}
  const conversationTabs=await page.locator('.conversation-navigation').evaluate(nav=>({flow:getComputedStyle(nav).gridAutoFlow,selectedLine:getComputedStyle(nav.querySelector('[aria-selected="true"]'),'::after').height,selectedInk:getComputedStyle(nav.querySelector('[aria-selected="true"]')).color,otherInk:getComputedStyle(nav.querySelector('.ak-button[aria-selected="false"]')).color}));
  assert.equal(conversationTabs.flow,'column');assert.equal(conversationTabs.selectedLine,'3px');assert.notEqual(conversationTabs.selectedInk,conversationTabs.otherInk,'selected tab has a stronger label as well as its signal bar');
  const titlebarToggle=page.locator('.window-actions .ak-button[aria-pressed]');
  assert.equal(await titlebarToggle.getAttribute('aria-pressed'),'true');
  await titlebarToggle.hover();
  const titlebarState=await titlebarToggle.evaluate(e=>{const s=getComputedStyle(e);return {bg:s.backgroundColor,fg:s.color,shadow:s.boxShadow,titlebarBg:getComputedStyle(e.closest('.window-titlebar')).backgroundColor}});
  assert.equal(titlebarState.shadow,'none','active titlebar icon has no navigation signal bar, even on hover');
  assert.notEqual(titlebarState.bg,titlebarState.titlebarBg,'active titlebar icon retains a blue selection fill');
  assert(contrast(titlebarState)>=4.5,'active titlebar icon remains readable');
  await titlebarToggle.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');
  assert.equal(await titlebarToggle.evaluate(e=>getComputedStyle(e).outlineColor),mode==='light'?'rgb(0, 117, 168)':'rgb(34, 187, 255)','active titlebar icon keeps its keyboard focus outline');
  const primary=page.locator('.sidebar-new-session');
  const primaryColors=await primary.evaluate(e=>{const s=getComputedStyle(e);return {bg:s.backgroundColor,fg:s.color}});
  assert.equal(primaryColors.bg,'rgb(255, 216, 2)','main action uses the ak-ui yellow palette');
  assert(contrast(primaryColors)>=4.5,'yellow buttons retain readable dark labels');
  await primary.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');
  assert.equal(await primary.evaluate(e=>e===document.activeElement),true,'keyboard navigation returns to the main action');
  assert.equal(await primary.evaluate(e=>getComputedStyle(e).outlineColor),mode==='light'?'rgb(0, 117, 168)':'rgb(34, 187, 255)','focus uses the official theme-appropriate blue');
  await primary.hover();
  assert.deepEqual(await primary.evaluate(e=>{const s=getComputedStyle(e);return {bg:s.backgroundColor,fg:s.color}}),primaryColors,'hover keeps the yellow action readable');
  await page.mouse.move(700,40);await primary.evaluate(e=>e.blur());
  assert.match(await primary.evaluate(e=>getComputedStyle(e).clipPath),/^polygon/);
  assert.equal(await primary.evaluate(e=>getComputedStyle(e,'::after').content),'none');
  const attachmentSizes=await page.locator('.composer .attachment-item').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().height));
  assert.equal(attachmentSizes.length,2);
  assert(attachmentSizes.every(height=>height<=60),'mixed attachments stay compact');
  assert.equal(attachmentSizes[0],attachmentSizes[1],'image and file use matching heights');
  const record=page.locator('.compact-record').first();await record.scrollIntoViewIfNeeded();
  assert((await record.boundingBox()).height<=54,'collapsed conversation record fits one row');
  await record.locator('summary').click();await record.locator('pre').waitFor();
  await record.locator('summary').click();
  await page.getByRole('tab',{name:'执行记录',exact:true}).click();
  const execution=page.locator('.execution-record').first();await execution.waitFor();await execution.scrollIntoViewIfNeeded();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert((await execution.boundingBox()).height<=54,'collapsed execution record fits one row');
  const table=page.getByRole('table',{name:'执行记录',exact:true});
  assert.equal(await table.getByRole('columnheader').count(),4);
  assert.equal(await execution.locator('.execution-duration').innerText(),'12.4s');
  assert.equal(await execution.locator('time').getAttribute('datetime'),'2026-09-22T14:33:01Z');
  await execution.getByRole('button').click();await table.locator('.execution-detail:not([hidden]) pre').waitFor();
  await table.screenshot({path:`${output}/executions-${mode}.png`});
  await execution.getByRole('button').click();

  await page.getByRole('tab',{name:'对话',exact:true}).click();
  await page.screenshot({path:`${output}/desktop-${mode}.png`});
 }
 const titlebarToggle=page.locator('.window-actions .ak-button[aria-pressed]');
 await titlebarToggle.click();assert.equal(await titlebarToggle.getAttribute('aria-pressed'),'false');
 await titlebarToggle.click();assert.equal(await titlebarToggle.getAttribute('aria-pressed'),'true');
 await page.getByRole('button',{name:'工作台设置',exact:true}).click();
 await page.getByRole('dialog',{name:'管理中心',exact:true}).waitFor();
 const selectedNav=page.locator('.management-nav [aria-selected="true"]');
 assert(contrast(await selectedNav.evaluate(e=>{const s=getComputedStyle(e);return {bg:s.backgroundColor,fg:s.color}}))>=4.5,'selected navigation label stays readable in the dark theme');
 assert.equal(await page.locator('.appearance-kit-info').count(),1);
 assert.equal(await page.locator('.appearance-kit-option').count(),0);
 assert.equal(await page.locator('.management-content').evaluate(e=>e.scrollTop),0);
 assert.equal(await page.getByRole('radiogroup',{name:'主题色'}).count(),1);
 assert.equal(await page.locator('.appearance-theme-option').count(),2);
 for(const transition of await page.locator('.appearance-theme-option').evaluateAll(nodes=>nodes.map(e=>getComputedStyle(e).transitionProperty))) assert(!/background|color|all/.test(transition),'theme cards must not animate between old and new theme colors');
 await page.getByRole('radio',{name:/浅色/}).check();
 assert(await page.getByRole('radio',{name:/浅色/}).isChecked());
 assert(contrast(await selectedNav.evaluate(e=>{const s=getComputedStyle(e);return {bg:s.backgroundColor,fg:s.color}}))>=4.5,'selected navigation label stays readable in the light theme');
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
 // An @-mentioned pending attachment collapses into its inline tag; deleting the mention restores the chip.
 await input.fill('请看 @pnpm-lock.yaml 这个文件');
 assert.equal(await page.locator('.composer .attachment-item').count(),1,'mentioned attachment is not duplicated as a chip');
 assert.deepEqual(await page.locator('.composer-mention').allTextContents(),['@pnpm-lock.yaml']);
 assert.deepEqual(await page.locator('.composer .attachment-item > :first-child').evaluateAll(nodes=>nodes.map(n=>Math.round(n.getBoundingClientRect().width))),[22],'image placeholder is the 22px thumb inside a chip');
 await input.fill('主题切换时保留这段草稿');
 assert.equal(await page.locator('.composer .attachment-item').count(),2);
 await page.setViewportSize({width:390,height:844});
 for(const mode of ['light','dark']){
  if(await page.locator('.app-shell').getAttribute('data-ui-theme')!==mode)await page.getByRole('button',{name:'切换明暗主题',exact:true}).click();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert(await input.isVisible());
  assert((await input.boundingBox()).width>250);
  const attachments=await page.locator('.composer .attachment-item').evaluateAll(items=>items.map(e=>e.getBoundingClientRect().top));
  assert.equal(new Set(attachments).size,1,'mobile attachments stay on one scrolling row');
  assert((await page.locator('.composer').boundingBox()).height<250,'composer leaves mobile reading space');
  await page.screenshot({path:`${output}/mobile-${mode}.png`});
 }
 const regions=page.getByRole('navigation',{name:'工作台区域'});
 await regions.getByRole('button',{name:'工作区',exact:true}).click();assert(await page.locator('.sidebar-new-session').isVisible());
 await regions.getByRole('button',{name:'侧边栏',exact:true}).click();assert(await page.locator('.inspector').isVisible());
 await regions.getByRole('button',{name:'会话',exact:true}).click();assert(await input.isVisible());
 await page.emulateMedia({reducedMotion:'reduce'});
 assert(await page.locator('.sidebar-new-session').evaluate(e=>parseFloat(getComputedStyle(e).transitionDuration)<.001));
 // The mockup has different sample content, so compare the shared design contract
 // and export paired screenshots for visual review instead of a misleading pixel threshold.
 const reference=await browser.newPage();
 await reference.goto(`http://127.0.0.1:${server.httpServer.address().port}/docs/design/ak-ui-redesign.html`);
 for(const [size,width,height] of [['desktop',1440,960],['mobile',390,844]]){
  await reference.setViewportSize({width,height});
  // Both surfaces share the viewport so widths are comparable, not just border anatomy.
  await page.setViewportSize({width,height});
  // A CDP resize lands before layout settles, so let both pages reach a stable box
  // rather than measuring the previous viewport's gutters.
  const settle=target=>target.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
  await settle(reference);await settle(page);
  const readColumn=node=>({width:Math.round(node.getBoundingClientRect().width),gap:getComputedStyle(node).rowGap});
  const designColumn=await reference.locator('#view-chat.feed-inner').evaluate(readColumn);
  const actualColumn=await page.locator('.timeline-feed-content').evaluate(readColumn);
  assert.deepEqual(actualColumn,designColumn,`${size} reading column matches the design study`);
  // The composer follows the design study's own gutter: the reading column on desktop, 8px on phones.
  const composerWidth=target=>target.locator('.composer').evaluate(node=>Math.round(node.getBoundingClientRect().width));
  assert.equal(await composerWidth(page),await composerWidth(reference),`${size} composer width matches the design study`);
  for(const mode of ['light','dark']){
   await reference.evaluate(mode=>document.body.dataset.theme=mode,mode);
   const design=await reference.locator('.composer').evaluate(e=>{const s=getComputedStyle(e);return {edge:s.borderLeftWidth,radius:s.borderRadius}});
   const actual=await page.locator('.composer').evaluate(e=>{const s=getComputedStyle(e);return {edge:s.borderLeftWidth,radius:s.borderRadius}});
   assert.deepEqual(actual,design,'composer geometry follows the approved ak-form reference');
   await reference.screenshot({path:`${output}/reference-${size}-${mode}.png`});
  }
 }
 await reference.close();
 await writeFile(`${output}/comparison.html`, `<!doctype html><meta charset="utf-8"><title>ak-ui 设计对照</title><style>body{font:16px sans-serif;margin:24px;background:#eee;color:#222}section{display:grid;grid-template-columns:1fr 1fr;gap:16px}img{max-width:100%;border:1px solid #aaa}h2{margin-top:40px}figure{margin:0}</style><h1>设计稿 / 实际应用</h1><p>内容不同，按层级、密度与表单规则对照；不是逐像素基准。</p>` + ['desktop','mobile'].flatMap(size=>['light','dark'].map(mode=>`<h2>${size} · ${mode}</h2><section><figure><figcaption>设计稿</figcaption><img src="reference-${size}-${mode}.png"></figure><figure><figcaption>实际应用</figcaption><img src="${size}-${mode}.png"></figure></section>`)).join(''));
 assert.deepEqual(errors,[]);
 console.log('PASS: actual App themes/migration, draft preservation, settings/native focus, provider chooser, layout recovery, responsive regions, reduced motion and clean browser console.');
}finally{await browser.close();await server.close()}
