import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

// Real App and browser interactions, with native IPC replaced by deterministic data.
const server = await createServer({server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false,watch:null}});
await server.listen();
const browser = await chromium.launch({headless:true});
const page = await browser.newPage({viewport:{width:1440,height:960}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
const output='/tmp/aibo-density';await mkdir(output,{recursive:true});
try {
  const installFixture=()=>{
    localStorage.setItem('aibo.appearance.v1',JSON.stringify({kitId:'ak-ui',themeId:'light'}));
    const workspace={id:'w1',label:'aibo-dev-with-a-long-workspace-name',path:'/probe/aibo',trust:'trusted',createdAt:'2026-09-22',updatedAt:'2026-09-22'};
    const session={id:'s1',workspaceId:'w1',label:'检查侧栏的信息密度和悬浮操作',agent:'third.party',pluginInstallationId:'third',state:'idle',capabilities:[],archived:false,externalSessionId:'a-long-external-session-identifier-for-overflow-check',createdAt:'2026-09-22',updatedAt:'2026-09-22T15:30:00.123Z'};
    const changes={workspaceId:'w1',head:'0c78fe5abcdef',branch:'main',dirty:true,capturedAt:'now',captureStatus:'captured',captureError:null,files:Array.from({length:8},(_,i)=>({path:`src/component-${i}.svelte`,previousPath:null,kind:'modified',staged:false,unstaged:true,untracked:false,conflicted:false}))};
    window.densityCalls=[];let callback=0;
    window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback(fn){const id=++callback;window['_'+id]=fn;return id;},unregisterCallback(id){delete window['_'+id];},async invoke(command,args={}){
      window.densityCalls.push({command,args});
      if(command==='get_app_snapshot')return {platform:'macos',appVersion:'probe',workspaceCount:1,diagnostics:[]};
      if(command.startsWith('plugin:event|'))return 1;
      if(command==='list_workspaces')return [workspace];
      if(command==='list_sessions')return [session];
      if(command==='get_presentation_selection'||command==='get_composer_draft'||command==='get_session_execution_profile'||command==='get_turn_change_set')return null;
      if(command==='save_composer_draft')return {text:args.text,sendFailed:false,updatedAt:'now'};
      if(command==='rename_session'){session.label=args.label;return {...session};}
      if(command==='list_plugin_installations')return ['Codex','Pi','Third-party'].map((label,i)=>({id:'provider-'+i,pluginId:'dev.example.'+i,pluginVersion:'1.0.0',packageDigest:'fixture-'+i,installed:true,enabled:true,runnable:true,dependencies:[],activationIssues:[],manifest:{displayName:label},contributions:[{id:'agent-'+i,kind:'capabilityProvider',scope:'session',required:true,metadata:{displayName:label,operations:[{capability:{id:'aibo.session.open'}}]}}]}));
      if(command==='inspect_workspace_capabilities')return {workspaceId:'w1',inspectedAt:'now',instructions:[],skills:[],mcpServers:[],warnings:[],tools:['workspace-read','workspace-search','artifact-store','checkpoint-restore','project-actions'].map(name=>({name,source:'core'}))};
      if(command==='list_workspace_git_repositories')return {repositories:[{id:'repo',name:'aibo',relativePath:'.',kind:'repository',externalRoot:false},{id:'nested',name:'tools',relativePath:'tools',kind:'repository',externalRoot:false}],limited:false,warnings:[],scanBudget:2000};
      if(command==='get_workspace_changes')return changes;
      if(command==='get_workspace_git_remote_status')return {branch:'main',upstream:'origin/main',ahead:1,behind:0};
      if(command==='get_timeline')return [{id:'a',sessionId:'s1',turnId:'t',role:'assistant',entryType:'message',content:'侧栏保留清晰的信息层级，操作在需要时出现。',status:'completed',createdAt:'2026-09-22'}];
      return [];
    }};
  };
  await page.addInitScript(installFixture);
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  await page.locator('.workspace-item').waitFor();
  if(await page.locator('.workspace-item').getAttribute('aria-expanded')!=='true')await page.locator('.workspace-item').click();
  await page.locator('.session-item').click();
  await page.getByRole('tab',{name:'上下文',exact:true}).click();
  await page.locator('.workspace-capabilities-card').waitFor();
  const row=page.locator('.workspace-item-row');const copy=row.locator('.workspace-copy');
  await page.mouse.move(700,40);const before=await copy.boundingBox();await row.hover();
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('.workspace-item-actions')).opacity==='1');
  assert.deepEqual(await copy.boundingBox(),before,'hover does not move or resize the workspace name');
  const more=row.getByRole('button',{name:/更多操作$/});
  const bounds=await more.boundingBox();assert(before.x+before.width<=bounds.x,'workspace label is not covered by hover actions');
  await page.screenshot({path:output+'/context-hover-light.png'});
  await more.click();const menu=page.locator('.row-action-menu:popover-open');await menu.waitFor();
  assert.equal(await menu.getByRole('button').count(),3);
  await menu.locator('button:focus').waitFor();
  await page.screenshot({path:output+'/workspace-menu-light.png'});
  await page.keyboard.press('Escape');await menu.waitFor({state:'hidden'});
  assert.equal(await more.evaluate(e=>e===document.activeElement),true,'Escape returns to its trigger');
  await more.click();await menu.getByRole('button',{name:/中打开工作区/}).click();
  await page.waitForFunction(()=>window.densityCalls.some(c=>c.command==='open_workspace_location'&&c.args.workspaceId==='w1'));
  assert.equal(await page.locator(':popover-open').count(),0,'choosing an action dismisses the menu');
  const sessionRow=page.locator('.session-item-row');await sessionRow.hover();
  await sessionRow.getByRole('button',{name:/更多操作$/}).click();
  await page.locator('.row-action-menu:popover-open').getByRole('button',{name:'改名',exact:true}).click();
  await page.locator('.session-rename-inline input').waitFor();
  await page.locator('.session-rename-inline input').press('Escape');
  const create=page.getByRole('button',{name:'新建会话',exact:true});
  await page.mouse.move(700,40);const accent=await create.evaluate(e=>getComputedStyle(e).backgroundColor);
  await create.hover();assert.equal(await create.evaluate(e=>getComputedStyle(e).backgroundColor),accent,'primary action retains its accent on hover');
  await create.click();
  const chooser=page.getByRole('group',{name:'选择 Agent 创建会话'});await chooser.waitFor();
  assert.equal(await chooser.locator('.session-agent-option').count(),3);
  assert((await chooser.boundingBox()).height<220,'three providers fit in a compact chooser');
  await page.screenshot({path:output+'/agent-chooser-light.png'});
  await page.keyboard.press('Escape');
  const caps=await page.locator('.workspace-capabilities-card').boundingBox();assert(caps.height<240,'capability rows have no nested padding');
  await page.getByRole('tab',{name:'Git',exact:true}).click();
  await page.getByRole('button',{name:'选择仓库',exact:true}).click();
  await page.getByRole('option',{name:/^aibo/}).click();
  await page.locator('.git-remote-row').waitFor();
  const gitHeader=await page.locator('[data-ui-component="workspace-git-panel"] .panel-heading').boundingBox();
  const remote=await page.locator('.git-remote-row').boundingBox();
  assert(remote.y+remote.height-gitHeader.y<310,'Git controls do not consume the whole side panel');
  const readability = await page.evaluate(() => {
    const name = document.querySelector('.changeset-file-name');
    const trigger = document.querySelector('.git-stash-trigger');
    return {nameClipped: name.scrollWidth > name.clientWidth, name: name.textContent,
      stashAlignment: getComputedStyle(trigger).justifyContent,
      sizes: [...document.querySelectorAll('.capability-list [data-slot="badge"], .git-remote-row, .session-context-content dd')].map(e => parseFloat(getComputedStyle(e).fontSize))};
  });
  assert.equal(readability.nameClipped, false, readability.name);
  assert.equal(readability.stashAlignment, 'space-between');
  assert(readability.sizes.every(size => size >= 12), 'secondary information stays readable');
  async function checkColorHierarchy() {
    const styles = await page.evaluate(() => {
      function background(e) { while(e){const color=getComputedStyle(e).backgroundColor;if(color!=='rgba(0, 0, 0, 0)'&&color!=='transparent')return color;e=e.parentElement}return '' }
      const bg=selector=>background(document.querySelector(selector));
      return {heading:bg('.git-change-group-heading'),file:bg('.changeset-file-row'),summary:bg('.git-summary-card'),canvas:bg('.timeline'),editor:bg('.composer'),
        selected:bg('.git-section-tabs [aria-selected="true"]'),rest:bg('.git-section-tabs [aria-selected="false"]')};
    });
    assert.notEqual(styles.heading,styles.file,'Git group heading separates from file content');
    assert.notEqual(styles.summary,styles.file,'branch summary separates from file content');
    assert.notEqual(styles.canvas,styles.editor,'editor separates from reading canvas');
    assert.notEqual(styles.selected,styles.rest,'Git selected tab has a visible surface signal');
  }
  await checkColorHierarchy();
  await page.screenshot({path:output+'/git-light.png'});
  await page.getByRole('button',{name:'切换明暗主题',exact:true}).click();
  await checkColorHierarchy();
  await page.screenshot({path:output+'/git-dark.png'});
  await page.getByRole('tab',{name:'上下文',exact:true}).click();
  await page.screenshot({path:output+'/context-dark.png'});
  await page.setViewportSize({width:1000,height:760});
  await row.hover();await more.click();await menu.waitFor();
  const narrow=await menu.boundingBox();assert(narrow.x>=0&&narrow.x+narrow.width<=1000&&narrow.y+narrow.height<=760,'menu stays within narrow desktop viewport');
  await page.mouse.click(700,40);await menu.waitFor({state:'hidden'});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const touch=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});
  touch.on('pageerror',e=>errors.push(e.message));await touch.addInitScript(installFixture);
  await touch.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  await touch.getByRole('navigation',{name:'工作台区域'}).getByRole('button',{name:'工作区',exact:true}).click();
  await touch.locator('.workspace-item-actions').waitFor();
  assert.equal(await touch.locator('.workspace-item-actions').evaluate(e=>getComputedStyle(e).opacity),'1','touch users can discover actions without hover');
  await touch.locator('.workspace-item-row').getByRole('button',{name:/更多操作$/}).tap();
  const touchMenu=touch.locator('.row-action-menu:popover-open');await touchMenu.waitFor();
  const box=await touchMenu.boundingBox();assert(box.x>=0&&box.x+box.width<=390&&box.y+box.height<=844);
  await touch.screenshot({path:output+'/touch-menu.png'});await touch.close();
  assert.deepEqual(errors,[]);
  console.log('PASS: dense context/Git, fixed hover geometry, workspace/session menus, native Escape/outside dismissal, action routing, three-provider chooser, both themes, narrow desktop and touch discovery.');
} catch(error) {
  console.error(JSON.stringify({errors}));await page.screenshot({path:output+'/failure.png'});throw error;
} finally {await browser.close();await server.close();}
