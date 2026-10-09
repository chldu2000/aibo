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
   const changes={workspaceId:'w',head:'head',branch:'main',dirty:true,capturedAt:'now',captureStatus:'captured',captureError:null,files:[{path:'原文{path}.txt',previousPath:null,kind:'modified',staged:true,unstaged:false,untracked:false,conflicted:false}]};
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
    if(command==='get_workspace_changes'){if(window.captureReadFailure)throw window.captureReadFailure;return window.captureFixture??changes;}
    if(command==='list_workspace_git_repositories')return {repositories:[{id:'repo',name:'Fixture',relativePath:'.',kind:'repository',externalRoot:false}],limited:false,warnings:['无法读取仓库 原文{path}','底层错误原文'],localizedWarnings:[{schema:'aibo.host-message/v1',key:'native.repository.unreadable',params:{path:'原文{path}'}},null],scanBudget:2000};
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
  await scope.getByText('无法读取仓库 原文{path}',{exact:true}).waitFor();
  const scans=await page.evaluate(()=>window.validationCalls.filter(call=>call.command==='list_workspace_git_repositories').length);
  await page.evaluate(async()=>{const {language}=await import('/src/lib/i18n/runtime.ts');language.set({preference:'en',locale:'en'});});
  await scope.getByText('Unable to read repository 原文{path}.',{exact:true}).waitFor();await scope.getByText('底层错误原文',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.validationCalls.filter(call=>call.command==='list_workspace_git_repositories').length),scans,JSON.stringify(await page.evaluate(()=>window.validationCalls.filter(call=>call.command==='list_workspace_git_repositories'))));
  await page.evaluate(async()=>{const {language}=await import('/src/lib/i18n/runtime.ts');language.set({preference:'zh-CN',locale:'zh-CN'});});
  await scope.getByText('无法读取仓库 原文{path}',{exact:true}).waitFor();
  await scope.getByRole('textbox',{name:/^提交/}).first().fill('原文提交 {message}');
  const frame=config.pkg?await page.locator('.presentation-external iframe').first().elementHandle():null;
  const locale=async value=>{await page.evaluate(async value=>{const {language}=await import('/src/lib/i18n/runtime.ts');language.set({preference:value,locale:value});},value);if(config.pkg)await page.waitForTimeout(250);};
  const refresh=()=>scope.getByRole('button',{name:config.pkg?'刷新变更':'刷新 Git 状态',exact:true}).click();
  const requests=()=>page.evaluate(()=>window.validationCalls.filter(call=>['list_workspace_git_repositories','get_workspace_changes','commit_workspace_changes','apply_workspace_git_file_action'].includes(call.command)));
  const descriptor=key=>({schema:'aibo.host-message/v1',key,params:{}});
  const fixtures=[
   {raw:'Git 不可用，非 Git 工作区暂不提供全局变更归属',metadata:descriptor('native.changes.gitUnavailable')},
   {raw:'非 Git 工作区暂不提供全局变更归属；本轮变更仍可用',metadata:descriptor('native.changes.nonGit')},
   {raw:'非 Git 工作区暂不提供全局变更归属；本轮变更仍可用'},
   {raw:'未知词条原文 {path}',metadata:descriptor('native.changes.unknown')},
   {raw:'错误 schema 原文 {path}',metadata:{schema:'other/v1',key:'native.changes.nonGit',params:{}}},
  ];
  for(const item of fixtures){
   const snapshot={workspaceId:'w',head:null,branch:null,dirty:false,capturedAt:'now',files:[],captureStatus:'unsupported',captureError:item.raw,...(item.metadata?{localizedCaptureError:item.metadata}:{})};
   const readCount=await page.evaluate(()=>window.validationCalls.filter(call=>call.command==='get_workspace_changes').length);
   await page.evaluate(snapshot=>{window.captureFixture=snapshot;},snapshot);await refresh();
   const expected=value=>item.metadata?.schema==='aibo.host-message/v1'&&['native.changes.nonGit','native.changes.gitUnavailable'].includes(item.metadata.key)?translateMessage(value,item.metadata):item.raw;
   await scope.getByText(expected('zh-CN'),{exact:true}).waitFor();
   await page.waitForFunction(readCount=>{const state=window.inspectCaptureFixture().canonical;return window.validationCalls.filter(call=>call.command==='get_workspace_changes').length===readCount+1&&!state.loading&&!state.metadataLoading&&JSON.stringify(state.changes)===JSON.stringify(window.captureFixture);},readCount);
   const before=await page.evaluate(()=>window.inspectCaptureFixture()),calls=await requests();
   assert.deepEqual(before.canonical.changes,snapshot);assert.equal(before.canonical.draft.commitMessage,'原文提交 {message}');
   for(const value of ['en','zh-CN']){
    await locale(value);await scope.getByText(expected(value),{exact:true}).waitFor();
    const current=await page.evaluate(()=>window.inspectCaptureFixture());
    assert.deepEqual(current.canonical,before.canonical);assert.equal(current.workspace,before.workspace);assert.equal(current.session,before.session);
    assert.equal(current.public.changes.captureError,expected(value));assert.equal('localizedCaptureError' in current.public.changes,false);
    for(const repo of current.public.repositories){assert.equal(repo.changes.captureError,expected(value));assert.equal('localizedCaptureError' in repo.changes,false);}
    assert.deepEqual(await requests(),calls);assert.deepEqual(await page.evaluate(()=>window.captureFixture),snapshot);
    if(frame)assert.equal(await frame.evaluate(el=>el.isConnected),true);
   }
  }
  await page.evaluate(()=>window.captureFixture=null);await refresh();
  await page.waitForFunction(()=>{const state=window.inspectCaptureFixture().canonical;return !state.loading&&state.changes?.captureStatus==='captured';});
  assert.equal(await scope.getByRole('textbox',{name:/^提交/}).first().inputValue(),'原文提交 {message}');
  assert.equal(await page.evaluate(()=>window.validationCalls.filter(call=>call.command==='commit_workspace_changes').length),0);
  for(const name of ['taskFailed','canonicalize','readHead','readStatus','statusExited']){
   const error={code:'database_error',message:'database error: 原始读取诊断 {message}',localized:{schema:'aibo.host-message/v1',key:'native.changes.'+name,params:{error:'底层 OS 原文 {error}',status:'原始状态 {status}'}}};
   const readCount=await page.evaluate(()=>window.validationCalls.filter(call=>call.command==='get_workspace_changes').length);
   await page.evaluate(error=>{window.captureReadFailure=error;},error);await refresh();
   await page.waitForFunction(readCount=>{const state=window.inspectCaptureFixture().canonical;return window.validationCalls.filter(call=>call.command==='get_workspace_changes').length===readCount+1&&!state.loading&&!state.metadataLoading&&state.repositories[0]?.error!==null;},readCount);
   await scope.getByText(translateMessage('zh-CN',error.localized),{exact:true}).waitFor();
   const before=await page.evaluate(()=>window.inspectCaptureFixture()),calls=await requests();
   assert.equal(before.canonical.draft.commitMessage,'原文提交 {message}');assert.equal(before.canonical.changes,null);
   for(const value of ['en','zh-CN']){
    await locale(value);await scope.getByText(translateMessage(value,error.localized),{exact:true}).waitFor();
    const current=await page.evaluate(()=>window.inspectCaptureFixture());assert.deepEqual(current.canonical,before.canonical);
    assert.equal(current.workspace,before.workspace);assert.equal(current.session,before.session);
    assert.equal(current.public.repositories[0].error,translateMessage(value,error.localized));
    assert.deepEqual(await requests(),calls);assert.deepEqual(await page.evaluate(()=>window.captureReadFailure),error);
    if(frame)assert.equal(await frame.evaluate(el=>el.isConnected),true);
   }
  }
  await page.evaluate(()=>window.captureReadFailure=null);await refresh();
  await page.waitForFunction(()=>{const state=window.inspectCaptureFixture().canonical;return !state.loading&&state.changes?.captureStatus==='captured'&&state.repositories[0].error===null;});
  assert.equal(await scope.getByRole('textbox',{name:/^提交/}).first().inputValue(),'原文提交 {message}');
  assert.deepEqual(errors,[]);await page.close();console.log(`${config.kit}/${config.theme}/${config.pkg?.release.manifest.id??'builtin'}: capture warnings switch language, retain canonical state and draft, no repeated reads or writes, explicit refresh recovers`);
 }

}finally{await browser.close();await server.close();await skins.dispose();}
