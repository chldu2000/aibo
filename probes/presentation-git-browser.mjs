import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const source="self.aiboPresentation={render(input){const g=input.data.git;return {tag:'main',key:'main',children:[{tag:'h1',key:'heading',text:'External Git'},{tag:'pre',key:'snapshot',attrs:{'aria-label':'Git snapshot'},text:JSON.stringify(g)},...input.data.navigationActions.filter(a=>a.operation==='selectWorkspace'||a.operation==='selectSession').map(a=>({tag:'button',key:a.token,text:a.operation+':'+a.targetId,events:{click:a.token}})),...input.data.gitActions.map(a=>a.event==='input'?{tag:'input',key:a.operation,attrs:{'aria-label':a.operation,value:g.draft[a.operation]??g[a.operation]??''},events:{input:a.token}}:{tag:'button',key:a.token,text:a.operation+(a.args.length?':'+a.args.join(':'):''),events:{click:a.token}}),{tag:'button',key:'forged',text:'Forged Git action',events:{click:'git:forged'}}]}}};";
const bytes=Buffer.from(source);
const pkg={release:{digest:'a'.repeat(64),enabled:true,manifest:{schema:'aibo.presentation-package/v1',id:'dev.example.workbench',version:'1.0.0',displayName:'External skin',hostApi:'1.0.0',coreSemantics:'1.0.0',snapshotSchemas:['aibo.semantic-view/v1'],entry:'skin.js',surfaces:['workbench'],resources:[{path:'skin.js',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),mediaType:'text/javascript'}]}},resources:{'skin.js':bytes.toString('base64')}};
const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false,watch:null}});await server.listen();
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];
page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(10000);
try {
  await page.addInitScript(pkg=>{
    let callback=0;window.presentationCommands=[];window.presentationInstallable=pkg;
    const workspaces = ['w1','w2'].map(id=>({id,label:id,path:'/probe/'+id,trust:'trusted',createdAt:'2026-09-13',updatedAt:'2026-09-13',lastOpenedAt:null}));
    const sessions = ['s1','s2'].map((id,index)=>({id,workspaceId:'w'+(index+1),label:id,agent:'plugin',state:'idle',archived:false,externalSessionId:null,pluginInstallationId:null,capabilities:[],createdAt:'2026-09-13',updatedAt:'2026-09-13'}));
    window.navigationCalls=[];
    const changed={path:'src/file.ts',previousPath:null,kind:'modified',staged:false,unstaged:true,untracked:false,conflicted:false};
    let commitAttempts=0;

    const read=()=>JSON.parse(localStorage.getItem('probe.presentation.installed')||'null');
    const saved=()=>JSON.parse(localStorage.getItem('probe.presentation.selection')||'null');
    window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},
      transformCallback(fn){const id=++callback;window['_'+id]=fn;return id;},unregisterCallback(id){delete window['_'+id];},
      async invoke(command,args={}){
        window.presentationCommands.push(command);window.navigationCalls.push({command,args});
        if(command==='list_workspace_git_repositories'&&window.selectorFixture)return {repositories:[{id:'one',name:'aibo',relativePath:'aibo'},{id:'two',name:'aibo-plugins',relativePath:'aibo-plugins'},{id:'packages/aibo',name:'aibo',relativePath:'packages/aibo'},{id:'long',name:'a-very-long-repository-name-for-layout-verification',relativePath:'packages/tools/a-very-long-repository-name-for-layout-verification'}].map(repo=>({...repo,kind:'repository',externalRoot:false})),limited:false,warnings:[],scanBudget:2000};
        if(command==='list_workspace_git_repositories')return {repositories:(window.multiRepository?['one','two']:['.']).map(id=>({id,name:id==='.'?'w1':id,relativePath:id,kind:'repository',externalRoot:false})),limited:false,warnings:[],scanBudget:2000};
        if(command==='get_workspace_changes')return {workspaceId:args.workspaceId,head:'head',branch:'main',dirty:true,capturedAt:'now',files:window.densityFixture?[changed,{...changed,path:'new.ts',kind:'added',staged:false,unstaged:false,untracked:true}]:[changed],captureStatus:'captured',captureError:null};
        if(command==='list_workspace_git_branches')return [{name:'main',current:true,commit:'head'},{name:'topic',current:false,commit:'old'}];
        if(command==='list_workspace_git_history'&&window.delayedRepositoryReads){if(args.repositoryId==='one')await new Promise(resolve=>setTimeout(resolve,300));return [{hash:'commit-a',shortHash:'commit-a',subject:args.repositoryId==='one'?'STALE ONE':'CURRENT TWO',author:'Author',authoredAt:'2026-09-13'}];}
        if(command==='list_workspace_git_history'){
          const entries=[{hash:'commit-a',shortHash:'commit-a',subject:'Earlier change',author:'Author',authoredAt:'2026-09-13'},...Array.from({length:19},(_,index)=>({hash:`older-${index}`,shortHash:`older-${index}`,subject:index===0?'fix(composer): @ 引用的文件不再重复显示附件卡片；图标与路径保持一致':`Older change ${index+1}`,author:'Author',authoredAt:'2026-09-12'}))];
          return entries.slice(args.offset??0,(args.offset??0)+(args.limit??30));
        }
        if(command==='get_workspace_git_remote_status')return {branch:'main',upstream:'origin/main',ahead:1,behind:1};
        if(command==='list_workspace_git_stashes')return [{reference:'stash@{0}',message:'Saved changes'}];
        if(command==='get_workspace_file_diff'||command==='get_workspace_git_commit_file_diff')return {path:args.path,staged:args.staged??false,available:true,truncated:true,diff:'@@ -1 +1 @@\n-before\n+after',hunks:[{index:0,header:'@@ -1 +1 @@',content:'-before\n+after'}],reason:'preview limit'};
        if(command==='list_workspace_git_commit_files')return {commit:args.commit,files:args.offset?[{path:'second.ts',previousPath:null,kind:'added'}]:[{path:'historical.ts',previousPath:'old.ts',kind:'renamed'}],total:2};
        if(command==='apply_workspace_git_file_action'){changed.staged=args.action==='stage';changed.unstaged=!changed.staged;return {applied:true,message:'ok',path:args.path,action:args.action};}
        if(command==='commit_workspace_changes')return ++commitAttempts===1?{committed:false,hash:null,message:'probe commit rejected'}:{committed:true,hash:'new-commit',message:'ok'};
        if(command==='create_workspace_git_branch'||command==='checkout_workspace_git_branch'||command==='sync_workspace_git'||command==='stash_workspace_git'||command==='apply_workspace_git_stash')return {applied:true,message:'ok',action:args.action??'branch'};
        if(command==='get_composer_draft')return null;
        if(command==='save_composer_draft')return {text:args.text,sendFailed:args.sendFailed,updatedAt:'2026-09-13'};
        if(command==='get_session_execution_profile'){
          const profile={schema:'aibo.execution-profile/v1',interactionMode:'ask',approvalPolicy:'on-request',filesystemPolicy:'read-only',commandPolicy:'disabled',networkPolicy:'disabled',model:null,reasoningEffort:null};
          return {schema:profile.schema,sessionId:args.sessionId,requested:profile,enforced:profile,unsupported:[],adapterCapabilities:[],nativeSandbox:true,resolvedAt:'2026-09-13'};
        }
        if(command==='list_workspaces')return workspaces;
        if(command==='list_sessions')return sessions.filter(session=>session.workspaceId===args.workspaceId);
        if(command==='rename_session'){const session=sessions.find(session=>session.id===args.sessionId);session.label=args.label;return {...session};}
        if(command==='archive_session'){const session=sessions.find(session=>session.id===args.sessionId);session.archived=true;return {...session};}
        if(command==='unarchive_session'){const session=sessions.find(session=>session.id===args.sessionId);session.archived=false;return {...session};}

        if(command==='plugin:dialog|open')return '/probe/package';
        if(command==='install_presentation_package'){localStorage.setItem('probe.presentation.installed',JSON.stringify(window.presentationInstallable));return window.presentationInstallable.release;}
        if(command==='list_presentation_packages')return read()?[read().release]:[];
        if(command==='get_presentation_selection')return saved();
        if(command==='read_presentation_package'){const value=read();if(!value?.release.enabled)throw Error('unavailable');return value;}
        if(command==='select_presentation_package'){
          if((saved()?.digest??null)!==args.expectedDigest)throw Error('superseded');
          localStorage.setItem('probe.presentation.selection',JSON.stringify(args.digest?{digest:args.digest,themeId:args.themeId}:null));return;
        }
        if(command==='set_presentation_package_enabled'){const value=read();value.release.enabled=args.enabled;localStorage.setItem('probe.presentation.installed',JSON.stringify(value));if(!args.enabled)localStorage.removeItem('probe.presentation.selection');return;}
        if(command==='uninstall_presentation_package'){localStorage.removeItem('probe.presentation.installed');localStorage.removeItem('probe.presentation.selection');return;}
        if(command.startsWith('plugin:event|'))return 1;
        if(command==='get_app_snapshot')return {platform:'macos',appVersion:'probe',workspaceCount:0,diagnostics:[]};
        return [];
      }};
  },pkg);
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
  await page.locator('body').click({position:{x:2,y:2}}); await page.keyboard.press('Meta+,');
  await page.getByRole('tab',{name:'插件与能力',exact:true}).click();
  await page.getByRole('button',{name:'安装皮肤插件',exact:true}).click();
  await page.getByRole('tab',{name:'外观',exact:true}).click();
  await page.getByRole('button',{name:'External skin 1.0.0',exact:true}).click();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('probe.presentation.selection')||'null')!==null);
  await page.getByRole('button',{name:'关闭设置',exact:true}).click();
  const frame=page.frameLocator('iframe');
  const snapshot=()=>frame.getByLabel('Git snapshot').textContent().then(JSON.parse);
  const waitSnapshot=async predicate=>{for(let i=0;i<100;i++){if(predicate(await snapshot()))return;await page.waitForTimeout(50);}throw Error('Git snapshot did not settle');};
  await frame.getByRole('heading',{name:'External Git'}).waitFor();
  await frame.getByRole('button',{name:'selectView:git',exact:true}).click();
  await frame.getByRole('textbox',{name:'commitMessage',exact:true}).waitFor();
  assert.equal((await snapshot()).remoteStatus.upstream,'origin/main');
  await frame.getByRole('button',{name:'openDiff:src/file.ts:unstaged',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('iframe')?.dataset.presentationRevision);
  await frame.getByRole('button',{name:'closeDiff',exact:true}).waitFor();
  await page.waitForTimeout(100);
  assert.equal((await snapshot()).preview.fileDiff.truncated,true);
  assert.equal((await snapshot()).preview.fileDiff.hunks[0].content,'-before\n+after');
  await frame.getByRole('button',{name:'closeDiff',exact:true}).click();
  await frame.getByRole('button',{name:'stageFile:src/file.ts',exact:true}).click();
  await frame.getByRole('button',{name:'unstageFile:src/file.ts',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.navigationCalls.find(c=>c.command==='apply_workspace_git_file_action').args.path),'src/file.ts');
  await frame.getByRole('button',{name:'Forged Git action',exact:true}).click();
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>window.navigationCalls.filter(c=>c.command==='apply_workspace_git_file_action').length),1);
  const message=frame.getByRole('textbox',{name:'commitMessage',exact:true});
  await message.pressSequentially('message across skins',{delay:10});
  await page.locator('body').click({position:{x:2,y:2}}); await page.keyboard.press('Meta+,');
  await page.getByRole('button',{name:'恢复内置皮肤',exact:true}).click();
  await page.getByRole('button',{name:'关闭设置',exact:true}).click();
  const native=page.getByRole('textbox',{name:'提交信息',exact:true});
  await native.waitFor();
  const panel=page.locator('[data-ui-component="workspace-git-panel"]');
  for(const width of [350,300]) {
    await page.locator('.workspace-grid').evaluate((el,width)=>el.style.setProperty('--workspace-inspector-width',`${width}px`),width);
    const rects=await panel.evaluate(el=>{
      const rect=selector=>{const r=el.querySelector(selector).getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,height:r.height};};
      return {panel:el.getBoundingClientRect().toJSON(),repository:rect('.git-repository-toolbar'),branch:rect('.git-branch-bar'),tabs:rect('.git-section-toolbar'),commit:rect('.git-commit-form'),group:rect('.git-change-group'),input:rect('.git-commit-form input'),submit:rect('.git-commit-form button'),row:rect('.changeset-file-row')};
    });
    assert.ok(rects.repository.bottom<=rects.branch.y+.5);
    assert.ok(rects.branch.bottom<=rects.tabs.y+.5);
    assert.ok(rects.tabs.bottom<=rects.commit.y+.5);
    assert.ok(rects.commit.bottom<=rects.group.y+.5);
    assert.ok(Math.abs(rects.input.y+rects.input.height/2-rects.submit.y-rects.submit.height/2)<.5,'commit input and action stay vertically centered on one row');
    assert.ok(rects.submit.right<=rects.panel.right,'commit action fits narrow inspector');
    assert.equal(rects.row.height,36,'file rows follow the reference design’s 36px density');
    assert.ok(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth),'no horizontal overflow');
    await panel.screenshot({path:`/tmp/aibo-git-layout-${width}.png`});
    await panel.getByRole('tab',{name:'历史',exact:true}).click();
    await panel.locator('.git-history-item').nth(1).waitFor();
    assert(await panel.locator('.git-history-item').nth(1).evaluate(item=>{
      const subject=item.querySelector('.git-history-copy strong');
      return subject.getBoundingClientRect().right<=item.getBoundingClientRect().right+.5
        && subject.scrollWidth>subject.clientWidth;
    }),`long history subjects truncate within the ${width}px inspector`);
    await panel.getByRole('tab',{name:'变更',exact:true}).click();
  }
  await page.locator('.workspace-grid').evaluate(el=>el.style.removeProperty('--workspace-inspector-width'));

  assert.equal(await native.inputValue(),'message across skins');await native.fill('edited in default');
  await page.locator('body').click({position:{x:2,y:2}}); await page.keyboard.press('Meta+,');
  await page.getByRole('button',{name:'External skin 1.0.0',exact:true}).click();
  await page.getByRole('button',{name:'关闭设置',exact:true}).click();
  assert.equal(await message.inputValue(),'edited in default');
  await frame.getByRole('button',{name:'commit:edited in default',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'probe commit rejected'}).waitFor();
  assert.equal(await message.inputValue(),'edited in default');
  await frame.getByRole('button',{name:'commit:edited in default',exact:true}).click();
  await page.waitForTimeout(200);assert.equal(await message.inputValue(),'');
  const branch=frame.getByRole('textbox',{name:'branchDraft',exact:true});await branch.fill('feature/skin');
  await frame.getByRole('button',{name:'createBranch:feature/skin',exact:true}).click();
  await page.waitForTimeout(150);assert.equal(await branch.inputValue(),'');
  await frame.getByRole('button',{name:'selectSection:history',exact:true}).click();
  await waitSnapshot(value=>value.history.length===16&&value.historyHasMore===true);
  await frame.getByRole('button',{name:'loadMoreHistory',exact:true}).click();
  await waitSnapshot(value=>value.history.length===20&&value.historyHasMore===false);
  await frame.getByRole('button',{name:'selectCommit:commit-a',exact:true}).click();
  await frame.getByRole('button',{name:'openCommitDiff:commit-a:historical.ts',exact:true}).click();
  await page.waitForTimeout(100);assert.equal((await snapshot()).preview.contextLabel,'w1 · 提交 commit-a · historical.ts');
  await frame.getByRole('button',{name:'loadMoreCommitFiles:commit-a',exact:true}).click();
  await frame.getByRole('button',{name:'openCommitDiff:commit-a:second.ts',exact:true}).waitFor();
  await frame.getByRole('button',{name:'fetch',exact:true}).click();
  await page.waitForFunction(()=>window.navigationCalls.some(c=>c.command==='sync_workspace_git'&&c.args.action==='fetch'));
  await page.evaluate(()=>{window.multiRepository=true;});
  await frame.getByRole('button',{name:'refresh',exact:true}).click();
  await frame.getByRole('button',{name:'repositoryUnstage:one:src/file.ts',exact:true}).waitFor();
  await frame.getByRole('button',{name:'repositoryUnstage:two:src/file.ts',exact:true}).click();
  await page.waitForFunction(()=>window.navigationCalls.some(c=>c.command==='apply_workspace_git_file_action'&&c.args.repositoryId==='two'));
  await frame.getByRole('button',{name:'selectRepository:one',exact:true}).click();
  await waitSnapshot(value=>value.repositoryId==='one');
  await message.fill('draft one'); await waitSnapshot(value=>value.draft.commitMessage==='draft one');
  await frame.getByRole('button',{name:'selectRepository:two',exact:true}).click();
  await waitSnapshot(value=>value.repositoryId==='two');
  await message.fill('draft two'); await waitSnapshot(value=>value.draft.commitMessage==='draft two');
  await frame.getByRole('button',{name:'selectRepository:one',exact:true}).click();
  await waitSnapshot(value=>value.repositoryId==='one');
  assert.equal(await message.inputValue(),'draft one');
  await frame.getByRole('button',{name:'selectRepository:two',exact:true}).click();
  await waitSnapshot(value=>value.repositoryId==='two');
  assert.equal(await message.inputValue(),'draft two');
  await frame.getByRole('button',{name:'openDiff:src/file.ts:unstaged',exact:true}).click();
  await page.waitForFunction(()=>window.navigationCalls.some(c=>c.command==='get_workspace_file_diff'&&c.args.repositoryId==='two'));
  await page.evaluate(()=>{window.delayedRepositoryReads=true;});
  await frame.getByRole('button',{name:'selectRepository:one',exact:true}).click();
  await waitSnapshot(value=>value.repositoryId==='one');
  await frame.getByRole('button',{name:'selectRepository:two',exact:true}).click();
  await waitSnapshot(value=>value.repositoryId==='two'&&value.history[0]?.subject==='CURRENT TWO');
  await page.waitForTimeout(400);
  assert.equal((await snapshot()).history[0].subject,'CURRENT TWO');
  await page.evaluate(()=>{window.delayedRepositoryReads=false;});
  await page.locator('body').click({position:{x:2,y:2}}); await page.keyboard.press('Meta+,');
  await page.getByRole('button',{name:'恢复内置皮肤',exact:true}).click();
  await page.getByRole('button',{name:'关闭设置',exact:true}).click();
  await page.getByRole('button',{name:'选择仓库',exact:true}).click();
  await page.getByRole('option',{name:/^所有仓库/}).click();
  const firstGroup=page.locator('section[aria-label="仓库 one one"]');
  await firstGroup.getByRole('button',{name:'暂存 src/file.ts',exact:true}).click();
  await page.waitForFunction(()=>window.navigationCalls.some(c=>c.command==='apply_workspace_git_file_action'&&c.args.repositoryId==='one'));
  await page.screenshot({path:'/tmp/aibo-multi-repositories.png'});
  await page.getByRole('tab',{name:'历史',exact:true}).click();
  await page.getByRole('option',{name:'one',exact:true}).click();
  await page.getByRole('button',{name:'查看提交 commit-a 的文件：Earlier change',exact:true}).waitFor();
  await page.evaluate(()=>{window.selectorFixture=true;});
  await page.getByRole('button',{name:'刷新 Git 状态',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-repository-select-trigger]')?.textContent.includes('aibo'));
  for (const [kit,theme] of [['ak-ui','light'],['ak-ui','dark']]) {
    await page.evaluate(async ({kit,theme})=>{const registry=await import('/src/lib/ui-kit/registry.ts');registry.setUiKit(kit);registry.setUiTheme(theme);},{kit,theme});
    const picker=page.getByRole('button',{name:'选择仓库',exact:true});
    await picker.click();
    const search=page.getByRole('combobox',{name:'搜索仓库',exact:true});
    await search.waitFor();
    assert.equal(await search.evaluate(element=>element===document.activeElement),true);
    assert.equal(await page.getByRole('option',{name:'aibo',exact:true}).count(),1);
    assert.equal(await page.getByRole('option',{name:'aibo，packages/aibo',exact:true}).count(),1);
    const rows=await page.getByRole('option').evaluateAll(elements=>elements.map(element=>{const r=element.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,width:r.width,height:r.height};}));
    for(let i=1;i<rows.length;i++){assert.equal(rows[i].x,rows[0].x);assert.ok(rows[i].y>=rows[i-1].y+rows[i-1].height);}
    assert.ok(await page.locator('.repository-popup').evaluate(element=>element.scrollWidth<=element.clientWidth));
    await page.locator('[data-ui-component="workspace-git-panel"]').screenshot({path:`/tmp/aibo-repository-picker-${kit}-${theme}.png`,animations:'disabled'});
    await search.fill('does-not-exist');
    await page.getByRole('status').filter({hasText:'没有匹配的仓库'}).waitFor();
    await search.fill('aibo-plugins');
    await search.press('Enter');
    await page.waitForFunction(()=>document.querySelector('[data-repository-select-trigger]')?.textContent.includes('aibo-plugins'));
    assert.equal(await picker.getAttribute('aria-expanded'),'false');
    await picker.press('ArrowDown');
    await search.waitFor();
    await search.press('Escape');
    assert.equal(await picker.getAttribute('aria-expanded'),'false');
    assert.equal(await picker.evaluate(element=>element===document.activeElement),true);
    await picker.click();
    await page.getByRole('tab',{name:'Git',exact:true}).click();
    assert.equal(await picker.getAttribute('aria-expanded'),'false');
    await picker.click();
    await search.press('ArrowDown');
    assert.ok(await search.evaluate(element=>document.getElementById(element.getAttribute('aria-activedescendant'))?.textContent.includes('packages/aibo')));
    await search.press('Enter');
    await page.waitForFunction(()=>document.querySelector('[data-repository-select-trigger]')?.title.endsWith('packages/aibo'));
    await picker.click();
    await page.getByRole('option',{name:'aibo',exact:true}).click();
  }
  await panel.getByRole('tab',{name:'变更',exact:true}).click();
  const unstage=page.getByRole('button',{name:'取消暂存 src/file.ts',exact:true});
  if(await unstage.count()) { await unstage.focus(); await unstage.click(); }
  await page.getByRole('button',{name:'暂存 src/file.ts',exact:true}).waitFor();
  await native.fill('draft before staging');
  assert.equal(await panel.getByRole('button',{name:'提交',exact:true}).isDisabled(),true);
  await native.press('Enter');
  assert.equal(await native.inputValue(),'draft before staging');
  await page.evaluate(()=>window.densityFixture=true);
  await page.getByRole('button',{name:'刷新 Git 状态',exact:true}).click();
  await panel.getByRole('region',{name:'未跟踪的文件',exact:true}).waitFor();
  for(const title of ['更改','未跟踪的文件']) {
    const group=panel.getByRole('region',{name:title,exact:true});
    const heading=group.locator('.git-change-group-heading');
    const count=heading.locator('.git-change-group-count');
    const action=heading.getByRole('button',{name:title==='未跟踪的文件'?'暂存全部未跟踪文件':'暂存全部更改',exact:true});
    await native.focus();
    await page.mouse.move(0,0);
    assert.equal(await action.evaluate(el=>getComputedStyle(el).opacity),'0');
    assert.equal(await count.evaluate(el=>getComputedStyle(el).opacity),'1');
    assert.equal((await heading.boundingBox()).height,36,'single-line group headings match the file-list density');
    const marker=await group.locator('.file-change-mark').first().boundingBox();
    assert.equal(marker.width,18);
    assert.equal(marker.height,18);
    const before=await count.boundingBox();
    await heading.hover();
    assert.equal(await action.evaluate(el=>getComputedStyle(el).opacity),'1');
    assert.equal(await count.evaluate(el=>getComputedStyle(el).opacity),'0');
    const button=await action.boundingBox();
    assert.ok(button.x<before.x+before.width && button.x+button.width>before.x,'bulk action covers the count without an extra column');
    await page.mouse.move(0,0);
    await action.focus();
    assert.equal(await action.evaluate(el=>getComputedStyle(el).opacity),'1','keyboard focus reveals the bulk action');
    const fileButton=group.locator('.changeset-file-button').first();
    await fileButton.hover();
    await fileButton.evaluate(el=>Promise.all(el.getAnimations().map(animation=>animation.finished)));
    const hoverStyle=await fileButton.evaluate(el=>({shadow:getComputedStyle(el).boxShadow,background:getComputedStyle(el).backgroundColor}));
    assert.equal(hoverStyle.shadow,'none','file hover must not inherit the generic button bottom signal');
    assert.equal(hoverStyle.background,'rgba(0, 0, 0, 0)','hover background belongs to the full file row');
    const fileAction=group.locator('.changeset-actions button').first();
    assert.equal(await fileAction.innerText(),'暂存');
    await fileAction.focus();
    await page.waitForFunction(title=>{const group=[...document.querySelectorAll('.git-change-group')].find(el=>el.getAttribute('aria-label')===title);return group && getComputedStyle(group.querySelector('.changeset-actions')).opacity==='1';},title);
  }
  for(const selector of ['.workspace-item','.session-item']) {
    const rows=await page.locator(selector).evaluateAll(els=>els.filter(el=>el.getClientRects().length).map(el=>el.getBoundingClientRect().height));
    assert.ok(rows.length>0);
    assert.ok(rows.every(height=>height>=44),`${selector} retains its original row height`);
  }
  await panel.screenshot({path:'/tmp/aibo-git-density.png'});
  await panel.getByRole('tab',{name:'历史',exact:true}).click();
  await panel.locator('.git-history-item').first().waitFor();
  const historyRows=await panel.locator('.git-history-item').evaluateAll(rows=>rows.map(row=>{
    const bounds=row.getBoundingClientRect(), subject=row.querySelector('strong').getBoundingClientRect(), time=row.querySelector('.git-history-time').getBoundingClientRect(), meta=row.querySelector('.git-history-meta').getBoundingClientRect();
    return {height:bounds.height,separateLines:subject.bottom<=meta.top,contained:subject.top>=bounds.top && meta.bottom<=bounds.bottom,firstLine:subject.right<time.left && time.bottom<=meta.top,inset:subject.left-bounds.left,separator:getComputedStyle(row.parentElement).borderBottomWidth};
  }));
  assert.ok(historyRows.length>0);
  assert.ok(historyRows.every(row=>row.height>=44 && row.separateLines && row.contained && row.firstLine && row.inset>=16 && row.separator==='1px'),`history keeps the reference’s inset, top-line time, second-line metadata, and row separators: ${JSON.stringify(historyRows.slice(0,2))}`);
  const historyItem=panel.locator('.git-history-item').first();
  await historyItem.hover();
  await historyItem.evaluate(el=>Promise.all(el.getAnimations().map(animation=>animation.finished)));
  assert.ok(!(await historyItem.evaluate(el=>getComputedStyle(el).boxShadow)).includes('0px -2px'),'commit history hover must not draw a bottom signal');
  await historyItem.click();
  await historyItem.evaluate(el=>Promise.all(el.getAnimations().map(animation=>animation.finished)));
  assert.match(await historyItem.evaluate(el=>getComputedStyle(el).boxShadow), /3px 0px 0px 0px inset/, 'selected history entry has a left signal');
  const commitFile=panel.locator('.git-commit-file').first();
  await commitFile.hover();
  await commitFile.evaluate(el=>Promise.all(el.getAnimations().map(animation=>animation.finished)));
  assert.equal(await commitFile.evaluate(el=>getComputedStyle(el).boxShadow),'none','expanded commit file hover must not draw a bottom signal');
  await panel.screenshot({path:'/tmp/aibo-git-history-density.png'});

  assert.deepEqual(errors,[]);
  const result={passed:true,nativePort:'mocked; actual App.svelte and Worker, no repository operations performed',browser:browser.version(),checks:['complete Git metadata and truncated hunk preview','stage targets host-selected file','forged action rejected','commit draft survives external/default/external switch','rejected commit keeps draft and successful commit clears it','branch draft and creation','history pagination through external action plus commit-file paging and preview','fetch dispatch through existing host controller','same-named file actions carry repository identity','drafts survive repository switches','delayed previous-repository history cannot overwrite selection','native all-repository grouping and scoped stage','history picker opens the selected repository history','repository picker layout and keyboard/search/dismissal in ak-ui light/dark themes','Git toolbar order, inline commit form and compact file rows at 300px and 350px']};
  await writeFile('/tmp/aibo-presentation-git-browser.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));

} catch(error) { console.error(JSON.stringify({errors,body:await page.locator('body').innerText()})); throw error; } finally {await browser.close();await server.close();}
