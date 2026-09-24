import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

// Real App and event handlers; only native reads use deterministic fixtures.
const server=await createServer({server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false,watch:null}});
await server.listen();
const browser=await chromium.launch({headless:true});
const output='/tmp/aibo-session-changes';await mkdir(output,{recursive:true});
const page=await browser.newPage({viewport:{width:1440,height:960}});
const errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(10000);
try {
  const installFixture=()=>{
    localStorage.setItem('aibo.appearance.v1',JSON.stringify({kitId:'ak-ui',themeId:'light'}));
    const workspace={id:'w',label:'aibo-dev',path:'/probe/aibo',trust:'trusted',createdAt:'2026-09-24',updatedAt:'2026-09-24'};
    const session={id:'s',workspaceId:'w',label:'会话区域变更列表',agent:'third-party',pluginInstallationId:'provider',state:'idle',capabilities:[],archived:false,createdAt:'2026-09-24',updatedAt:'2026-09-24'};
    const file=(path,extra={})=>({path,previousPath:null,kind:'modified',staged:false,unstaged:true,untracked:false,conflicted:false,...extra});
    const original=[file('src/lib/ui-kit/kits/ak-ui.css',{unstagedStats:{additions:48,deletions:112},staged:true,stagedStats:{additions:6,deletions:2}}),file('src/lib/ui-kit/kits/ak-ui/themes.json',{staged:true,unstaged:false,stagedStats:{additions:6,deletions:2}}),file('docs/design/ak-ui-redesign.html',{kind:'added',untracked:true,unstaged:false,unstagedStats:{additions:620,deletions:0}})];
    window.changeFixture={files:original,repositories:[{id:'repo',name:'aibo',relativePath:'.',kind:'repository',externalRoot:false}],calls:[],fail:false,delay:false,pending:[],unavailable:false,limited:false,repoError:false};
    window.restoreChanges=()=>{window.changeFixture.files=original;window.changeFixture.repositories=[{id:'repo',name:'aibo',relativePath:'.',kind:'repository',externalRoot:false}];window.changeFixture.repoError=false;window.changeFixture.limited=false;};
    let callback=0;
    window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback(fn){const id=++callback;window['_'+id]=fn;return id;},unregisterCallback(id){delete window['_'+id];},async invoke(command,args={}){
      const f=window.changeFixture;f.calls.push({command,args});
      if(command==='get_app_snapshot')return {platform:'macos',appVersion:'probe',workspaceCount:1,diagnostics:[]};
      if(command.startsWith('plugin:event|'))return 1;
      if(command==='list_workspaces')return [workspace];
      if(command==='list_sessions')return [session,{...session,id:'s2',label:'另一会话'}];
      if(command==='get_presentation_selection'||command==='get_composer_draft'||command==='get_session_execution_profile'||command==='get_turn_change_set')return null;
      if(command==='save_composer_draft')return {text:args.text,sendFailed:false,updatedAt:'now'};
      if(command==='list_plugin_installations')return [{id:'provider',pluginId:'dev.example.independent',pluginVersion:'1.0.0',packageDigest:'fixture',installed:true,enabled:true,runnable:true,dependencies:[],activationIssues:[],manifest:{displayName:'Independent'},contributions:[{id:'third-party',kind:'capabilityProvider',scope:'session',metadata:{displayName:'Independent',operations:[{capability:{id:'aibo.session.open'}}]}}]}];
      if(command==='inspect_workspace_capabilities')return {workspaceId:'w',inspectedAt:'now',instructions:[],skills:[],mcpServers:[],warnings:[],tools:[]};
      if(command==='list_workspace_git_repositories')return {repositories:f.repositories,limited:f.limited,warnings:[],scanBudget:2000};
      if(command==='get_workspace_changes'){
        if(f.repoError)throw Error('仓库暂不可读');
        return {workspaceId:'w',head:'head',branch:'main',dirty:f.files.length>0,capturedAt:'now',captureStatus:'captured',captureError:null,files:f.files};
      }
      if(command==='get_workspace_git_remote_status')return {branch:'main',upstream:null,ahead:0,behind:0};
      if(command==='get_workspace_file_diff'){
        if(f.fail)throw Error('读取差异失败');
        const value={path:args.path,staged:args.staged,available:!f.unavailable,truncated:false,reason:f.unavailable?'二进制文件无法显示文本差异':null,diff:`diff --git a/${args.path} b/${args.path}\n@@ -1 +1 @@\n-old\n+${args.repositoryId}:${args.path}:${args.staged?'index':'working'}`,hunks:[]};
        if(f.delay)return new Promise(resolve=>f.pending.push(()=>resolve(value)));
        return value;
      }
      if(command==='get_timeline')return [{id:'a',sessionId:args.sessionId,role:'assistant',entryType:'message',toolName:null,content:'检查本次改动。',status:'completed',createdAt:'2026-09-24'}];
      return [];
    }};
  };
  await page.addInitScript(installFixture);
  const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
  await page.goto(origin);
  await page.locator('.workspace-item').waitFor();
  if(await page.locator('.workspace-item').getAttribute('aria-expanded')!=='true')await page.locator('.workspace-item').click();
  await page.locator('.session-item').filter({hasText:'会话区域变更列表'}).click();
  const tab=page.locator('#session-tab-changes');await tab.click();
  const panel=page.locator('#session-panel-changes');
  const rows=panel.locator('.session-change-row');
  const refresh=()=>panel.getByRole('button',{name:'刷新变更',exact:true}).click();
  const first=rows.first();
  await first.waitFor();
  await page.locator('[data-composer-input]').fill('保留会话草稿');
  for(const theme of ['light','dark']) {
    if(await page.locator('.app-shell').getAttribute('data-ui-theme')!==theme)await page.getByRole('button',{name:'切换明暗主题',exact:true}).click();
    assert.match(await tab.innerText(),/变更\s*3/);
    assert.equal(await panel.locator('.session-changes-repo-heading').count(),0,'single repo does not add a redundant heading');
    assert.equal(await panel.getByRole('button',{name:/查看.*差异/}).count(),0,'there are no separate diff buttons');
    assert.deepEqual(await rows.evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().height)),[36,36,36]);
    assert.equal(await first.locator('.file-change-mark').innerText(),'M');
    assert.equal(await first.locator('.session-change-name').innerText(),'ak-ui.css');
    assert.equal(await first.locator('.session-change-directory').innerText(),'src/lib/ui-kit/kits/');
    assert.equal(await first.locator('.session-change-stats').getAttribute('aria-label'),'新增 54 行，删除 114 行');
    assert((await panel.locator('.session-changes').boundingBox()).width<=760);
    await panel.screenshot({path:`${output}/list-${theme}.png`});
    await first.focus();await page.keyboard.press('Enter');
    const preview=first.locator('..').locator('.session-change-preview');
    await preview.getByText('repo:src/lib/ui-kit/kits/ak-ui.css:working',{exact:true}).waitFor();
    assert.equal(await first.getAttribute('aria-expanded'),'true');
    assert(await preview.evaluate(el=>el.previousElementSibling?.getAttribute('aria-expanded')==='true'),'preview immediately follows its row');
    await first.evaluate(el=>Promise.all(el.getAnimations().map(animation=>animation.finished)));
    const selected=await first.evaluate(el=>({bg:getComputedStyle(el).backgroundColor,shadow:getComputedStyle(el).boxShadow}));
    assert.notEqual(selected.shadow,'none');await first.hover();
    assert.deepEqual(await first.evaluate(el=>({bg:getComputedStyle(el).backgroundColor,shadow:getComputedStyle(el).boxShadow})),selected,'selection survives hover');
    await preview.getByRole('button',{name:'暂存区',exact:true}).click();
    await preview.getByText('repo:src/lib/ui-kit/kits/ak-ui.css:index',{exact:true}).waitFor();
    assert.equal(await preview.getByRole('button',{name:'暂存区',exact:true}).getAttribute('aria-pressed'),'true');
    await panel.screenshot({path:`${output}/expanded-${theme}.png`});
    await preview.getByRole('button',{name:'关闭文件差异预览'}).click();
    assert.equal(await first.getAttribute('aria-expanded'),'false');
    assert(await first.evaluate(el=>document.activeElement===el),'close restores row focus');
    await page.keyboard.press('Space');await preview.waitFor({state:'visible'});
    await page.keyboard.press('Space');await preview.waitFor({state:'hidden'});
    await rows.nth(1).click();
    await rows.nth(1).locator('..').getByText('repo:src/lib/ui-kit/kits/ak-ui/themes.json:index',{exact:true}).waitFor();
    assert.equal(await rows.nth(1).locator('..').getByRole('group',{name:'差异来源'}).count(),0,'index-only files open directly');
    await rows.nth(1).click();
    assert.equal(await page.locator('[data-composer-input]').inputValue(),'保留会话草稿');
  }
  // Loading, switching and late completion all remain attached to the selected file.
  await page.evaluate(()=>window.changeFixture.delay=true);
  await first.click();await panel.getByText('正在读取差异…',{exact:true}).waitFor();
  await rows.nth(1).click();
  await page.waitForFunction(()=>window.changeFixture.pending.length===2);
  await page.evaluate(()=>{window.changeFixture.pending.splice(0).reverse().forEach(finish=>finish());window.changeFixture.delay=false;});
  await rows.nth(1).locator('..').getByText('repo:src/lib/ui-kit/kits/ak-ui/themes.json:index',{exact:true}).waitFor();
  assert.equal(await first.getAttribute('aria-expanded'),'false');
  await rows.nth(1).click();
  await page.evaluate(()=>window.changeFixture.fail=true);await first.click();
  await first.locator('..').getByRole('alert').waitFor();
  await first.click();await page.evaluate(()=>window.changeFixture.fail=false);await first.click();
  await first.locator('..').getByText('repo:src/lib/ui-kit/kits/ak-ui.css:working',{exact:true}).waitFor();
  await first.click();
  await page.evaluate(()=>window.changeFixture.unavailable=true);await rows.nth(2).click();
  await rows.nth(2).locator('..').getByText('二进制文件无法显示文本差异',{exact:true}).waitFor();
  await rows.nth(2).click();await page.evaluate(()=>window.changeFixture.unavailable=false);
  // Same path in two repositories must never render the same preview twice.
  await page.evaluate(()=>window.changeFixture.repositories.push({id:'other',name:'nested',relativePath:'nested',kind:'repository'}));
  await refresh();await page.waitForFunction(()=>document.querySelectorAll('.session-change-row').length===6);
  assert.match(await tab.innerText(),/变更\s*6/);
  assert.equal(await panel.locator('.session-changes-repo-heading').count(),2);
  await rows.nth(3).click();
  await rows.nth(3).locator('..').getByText('other:src/lib/ui-kit/kits/ak-ui.css:working',{exact:true}).waitFor();
  assert.equal(await panel.locator('.workspace-file-diff-preview').count(),1);
  assert.equal(await rows.nth(0).getAttribute('aria-expanded'),'false');
  await panel.screenshot({path:`${output}/multiple-repositories.png`});
  await page.locator('.session-item').filter({hasText:'另一会话'}).click();
  await tab.click();assert.equal(await panel.locator('.workspace-file-diff-preview').count(),0,'session switch clears the previous inline preview');
  // Narrow names keep their full accessible path; unknown counts are absent.
  await page.evaluate(()=>{window.restoreChanges();window.changeFixture.files=[{...window.changeFixture.files[0],path:'src/目录/'.repeat(10)+'一个很长的文件名字-very-long-file-name.ts',stagedStats:null,unstagedStats:null}];});
  await refresh();await page.waitForFunction(()=>document.querySelectorAll('.session-change-row').length===1);
  assert.equal(await first.locator('.session-change-stats').count(),0);
  for(const width of [1024,390]) {
    await page.setViewportSize({width,height:900});
    await first.click();await panel.locator('.workspace-file-diff-preview').waitFor();
    assert(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'changes do not overflow horizontally');
    assert(await first.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'file row stays within the reading column');
    const composer=await page.locator('[data-composer-input]').boundingBox();assert(composer&&composer.y+composer.height<=900);
    await page.screenshot({path:`${output}/narrow-${width}.png`});
    await first.click();
  }
  await page.setViewportSize({width:1440,height:960});
  await page.evaluate(()=>window.changeFixture.files=[]);await refresh();await panel.getByText('没有未提交变更。',{exact:true}).waitFor();
  assert.match(await tab.innerText(),/变更\s*0/);
  await page.evaluate(()=>window.changeFixture.repoError=true);await refresh();await panel.getByRole('alert').waitFor();
  assert.equal(await tab.locator('.session-changes-count').count(),0,'failed reads do not claim zero changes');
  await page.evaluate(()=>{window.restoreChanges();window.changeFixture.limited=true;});await refresh();
  await panel.getByText('仓库扫描尚未完成，以下仅显示已发现的仓库。',{exact:true}).waitFor();
  assert.equal(await tab.locator('.session-changes-count').count(),0);
  // Coarse-pointer targets grow without enlarging the desktop design.
  const touch=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  await touch.addInitScript(installFixture);
  const touchPage=await touch.newPage();await touchPage.goto(origin);
  await touchPage.getByRole('button',{name:'工作区',exact:true}).click();
  await touchPage.locator('.workspace-item').waitFor();
  if(await touchPage.locator('.workspace-item').getAttribute('aria-expanded')!=='true')await touchPage.locator('.workspace-item').click();
  await touchPage.locator('.session-item').filter({hasText:'会话区域变更列表'}).click();
  await touchPage.getByRole('button',{name:'会话',exact:true}).click();
  await touchPage.locator('#session-tab-changes').click();
  const touchRow=touchPage.locator('.session-change-row').first();await touchRow.waitFor();
  assert.equal((await touchRow.boundingBox()).height,44);
  await touchRow.tap();await touchPage.getByText('repo:src/lib/ui-kit/kits/ak-ui.css:working',{exact:true}).waitFor();
  await touchPage.screenshot({path:`${output}/touch.png`});await touch.close();
  assert.deepEqual(errors,[]);
  console.log(`PASS: inline file diffs, source switching, true counts, stale reads, themes, multi-repo identity, keyboard, errors, narrow layouts. Screenshots: ${output}`);
} finally {await browser.close();await server.close();}
