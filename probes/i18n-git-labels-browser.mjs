import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {translateMessage} from '../packages/i18n/index.js';
import {buildPresentationSkins} from './lib/build-presentation-skins.mjs';
const skins=await buildPresentationSkins();
const server=await createServer({server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false,watch:null},plugins:[{name:'observe-capture-display',enforce:'pre',transform(code,id){
 if(!id.endsWith('/src/App.svelte'))return;
 const marker='  const capabilityWorkbenchDirectory =';assert.ok(code.includes(marker));
 return code.replace(marker,`  if(typeof window!=='undefined')Object.assign(window,{inspectCaptureFixture(){return JSON.parse(JSON.stringify({canonical:git,public:externalGit,workspace:selectedWorkspaceId,session:selectedSessionId}));}});\n${marker}`);
}}]});await server.listen();
const browser=await chromium.launch({headless:true});
try{
 const cases=['material3','ak-ui'].flatMap(kit=>['light','dark'].map(theme=>({kit,theme,pkg:null})));
 for(const pkg of skins.packages)cases.push({kit:'material3',theme:'light',pkg});
 for(const config of cases){
  const page=await browser.newPage({viewport:{width:1280,height:900}});page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(({kit,theme,pkg})=>{
   if(window!==window.top)return;
   // Isolate language-triggered reads from the independent 1.25 s Git poll.
   // Polling behavior is covered by the workspace Git controller regressions.
   const interval=window.setInterval.bind(window);
   window.setInterval=(callback,delay,...args)=>interval(delay===1250?()=>{}:callback,delay,...args);
   localStorage.setItem('aibo.language.v1','zh-CN');localStorage.setItem('aibo.appearance.v1',JSON.stringify({kitId:kit,themeId:theme}));
   localStorage.setItem('aibo.workbench-layout.v1.main',JSON.stringify({activeView:pkg?'context':'git',auxiliaryOpen:true}));
   const changes={workspaceId:'w',head:'head',branch:'main',dirty:true,capturedAt:'now',captureStatus:'captured',captureError:null,files:['modified','added','deleted','renamed'].map(kind=>({path:kind+' 原文{path}.txt',previousPath:null,kind,staged:true,unstaged:false,untracked:false,conflicted:false}))};
   let callback=0;window.validationCalls=[];
   window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback(fn){const id=++callback;window['_'+id]=fn;return id},unregisterCallback(id){delete window['_'+id]},async invoke(command,args={}){
    window.validationCalls.push({command,args});
    if(command.startsWith('plugin:event|'))return 1;
    if(command==='get_app_snapshot')return {platform:'macos',appVersion:'probe',workspaceCount:1,diagnostics:[]};
    if(command==='read_workspace_preferences')return {trustNewWorkspaces:true};
    if(command==='get_presentation_selection')return pkg?{digest:pkg.release.digest,themeId:pkg.release.manifest.themes[0].id}:null;
    if(command==='list_presentation_packages')return pkg?[pkg.release]:[];
    if(command==='read_presentation_package')return pkg;
    if(command==='list_workspaces')return [{id:'w',path:'/probe',label:'Project',trust:'trusted',createdAt:'now',updatedAt:'now'}];
    if(command==='get_workspace_changes')return {...changes,branch:args.repositoryId==='literal'?'Detached HEAD':null};
    if(command==='list_workspace_git_repositories')return {repositories:[{id:'repo',name:'Worktree {name}',relativePath:'树目录{path}',kind:'worktree',externalRoot:false},{id:'literal',name:'Literal {name}',relativePath:'真实分支{path}',kind:'repository',externalRoot:false}],limited:false,warnings:[],scanBudget:2000};
    if(command==='get_workspace_git_remote_status')return {branch:'main',upstream:null,ahead:0,behind:0};
    if(command==='inspect_workspace_capabilities')return {workspaceId:'w',inspectedAt:'now',instructions:[],skills:[],tools:[],mcpServers:[],warnings:[]};
    if(command==='get_composer_draft'||command==='get_turn_change_set')return null;
    if(command==='commit_workspace_changes'){
     if(window.validationFailure)throw window.validationFailure;
     if(window.validationKey==='native.git.noStagedChanges')return {committed:false,hash:null,message:'没有已暂存的更改可提交',localizedMessage:{schema:'aibo.host-message/v1',key:window.validationKey,params:{}}};
     if(window.validationKey==='native.error.writeOutcomeUnknown')throw {code:'outcome_unknown',message:'原始诊断',localized:{schema:'aibo.host-message/v1',key:window.validationKey,params:{error:{key:'native.git.stopped',params:{action:'commit',output:'原文 {output}'}}}}};
     if(window.validationKey==='native.git.truncatedOutput')return {committed:false,hash:null,message:'原文 {output}\n… Git 输出已截断',localizedMessage:{schema:'aibo.host-message/v1',key:window.validationKey,params:{output:'原文 {output}'}}};
     if(window.validationKey.startsWith('native.turn.'))throw {code:window.validationKey==='native.turn.restoreCancelled'?'cancelled':'invalid_workspace_path',message:'旧版诊断',localized:{schema:'aibo.host-message/v1',key:window.validationKey,params:{}}};
     throw {code:'database_error',message:'database error: 提交信息不能为空',localized:{schema:'aibo.host-message/v1',key:window.validationKey,params:{}}};
    }
    return [];
   }};
  },config);
  await page.goto('http://127.0.0.1:'+server.httpServer.address().port+'/',{timeout:60000});
  let scope=page;
  if(config.pkg){await page.locator('.presentation-external iframe').first().waitFor();scope=page.frameLocator('.presentation-external iframe').first();await scope.getByRole('button',{name:'Git',exact:true}).click();
   // Worker intents settle after click(). Wait for the host's persisted view acknowledgement.
   await page.waitForFunction(()=>JSON.parse(localStorage.getItem('aibo.workbench-layout.v1.main')??'{}').activeView==='git');
   await page.locator('.presentation-external iframe').first().evaluate(el=>el.dataset.probeIdentity='same');}
  await page.waitForFunction(()=>{const state=window.inspectCaptureFixture().canonical;return !state.loading&&state.repositories.length===2&&state.repositories.every(repo=>repo.changes!==null);});
  const group=name=>scope.getByRole('region',{name:new RegExp(name+' \\{name\\}')}).first();
  const frame=config.pkg?await page.locator('.presentation-external iframe').first().elementHandle():null;
  const locale=async value=>{await page.evaluate(async value=>{const {language}=await import('/src/lib/i18n/runtime.ts');language.set({preference:value,locale:value});},value);if(config.pkg)await page.waitForTimeout(250);};
  const calls=()=>page.evaluate(()=>window.validationCalls.filter(call=>['list_workspace_git_repositories','get_workspace_changes','list_workspace_git_branches','list_workspace_git_history','get_workspace_git_remote_status','commit_workspace_changes','apply_workspace_git_file_action'].includes(call.command)));
  const original=await page.evaluate(()=>window.inspectCaptureFixture()),requests=await calls();
  assert.equal(original.canonical.repositoryId,null);
  for(const value of ['zh-CN','en','zh-CN']){
   await locale(value);
   const worktree=await group('Worktree').textContent(),literal=await group('Literal').textContent();
   assert.ok(worktree.includes(value==='en'?'Detached HEAD':'分离 HEAD'),worktree);
   assert.ok(worktree.includes(value==='en'?' · Worktree':' · 工作树'),worktree);
   assert.ok(worktree.includes('树目录{path}'),worktree);
   for(const [kind,zh,en] of [['modified','修改','Modified'],['added','新增','Added'],['deleted','删除','Deleted'],['renamed','重命名','Renamed']]){assert.ok(worktree.includes(kind+' 原文{path}.txt'),worktree);if(config.pkg)assert.ok(worktree.includes((value==='en'?en:zh)+' '+kind+' 原文{path}.txt'),worktree);}
   assert.ok(literal.includes('Detached HEAD'),literal);assert.ok(literal.includes('真实分支{path}'),literal);
   assert.deepEqual(await page.evaluate(()=>window.inspectCaptureFixture()),original);assert.deepEqual(await calls(),requests);
   if(frame)assert.equal(await frame.evaluate(el=>el.isConnected),true);
  }
  await group('Worktree').getByRole('button',{name:'提交…',exact:true}).click();
  await page.waitForFunction(()=>{const state=window.inspectCaptureFixture().canonical;return state.repositoryId==='repo'&&!state.metadataLoading;});
  await scope.getByRole('textbox',{name:/^提交/}).first().fill('原文提交 {message}');
  if(config.pkg)await page.waitForTimeout(250);
  const selected=await page.evaluate(()=>window.inspectCaptureFixture()),selectedRequests=await calls();
  assert.equal(selected.canonical.changes.branch,null);assert.equal(selected.canonical.draft.commitMessage,'原文提交 {message}');
  for(const value of ['en','zh-CN']){
   await locale(value);
   const field=scope.getByRole('textbox',{name:value==='en'?/^Commit/:/^提交/}).first();
   assert.equal(await field.inputValue(),'原文提交 {message}');
   if(config.pkg)for(const [zh,en] of [['修改','Modified'],['新增','Added'],['删除','Deleted'],['重命名','Renamed']])await scope.getByText((value==='en'?en:zh)+(value==='en'?' · Staged':' · 已暂存'),{exact:true}).waitFor();
   if(config.pkg)assert.ok((await field.getAttribute('aria-label')).includes(value==='en'?'Detached HEAD':'分离 HEAD'));
   else await scope.getByText(value==='en'?'Detached HEAD':'分离 HEAD',{exact:true}).waitFor();
   assert.deepEqual(await page.evaluate(()=>window.inspectCaptureFixture()),selected);assert.deepEqual(await calls(),selectedRequests);
   if(frame)assert.equal(await frame.evaluate(el=>el.isConnected),true);
  }
  assert.equal(await page.evaluate(()=>window.validationCalls.filter(call=>call.command==='commit_workspace_changes'||call.command==='apply_workspace_git_file_action').length),0);
  assert.deepEqual(errors,[]);await page.close();console.log(`${config.kit}/${config.theme}/${config.pkg?.release.manifest.id??'builtin'}: detached and worktree labels switch language, literal branch and paths retained, draft and state unchanged, no repeated reads or writes`);
 }

}finally{await browser.close();await server.close();await skins.dispose();}
