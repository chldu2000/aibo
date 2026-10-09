import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {translateMessage} from '../packages/i18n/index.js';
import {buildPresentationSkins} from './lib/build-presentation-skins.mjs';
const skins=await buildPresentationSkins();
const server=await createServer({server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false,watch:null}});await server.listen();
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
    if(command==='get_workspace_changes')return changes;
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
  const field=()=>scope.getByRole('textbox',{name:/^提交/}).first();
  const reason=(key,params={})=>({schema:'aibo.host-message/v1',key:'native.writeRun.'+key,params});
  const ledgerErrors=[
   ...["timeout", "bounds", "fileType", "fileTimeout", "untrackedLimit", "pathEncoding", "relativePath", "noParent", "symbolicDirectory", "rootEncoding", "nestedLimit", "administrativeEncoding", "indexEntry", "submoduleNotEmpty", "unregisteredRepository", "inspectionFailed", "fileFailed"].map(name=>({code:'invalid_workspace_path',message:'原始 Git 审批检查诊断 /{message}',localized:{schema:'aibo.host-message/v1',key:'native.gitApproval.'+name,params:{error:'底层 OS 原文 /{error}'}}})),
   ...['workspaceUnavailable','parentUnavailable','outsideWorkspace','noParent'].map(name=>({code:'invalid_workspace_path',message:'原始路径诊断 /{message}',localized:{schema:'aibo.host-message/v1',key:'native.path.'+name,params:{error:'底层 OS 原文 /{error}'}}})),
   ...['native.git.unsupportedIndex','native.git.pathEncoding','native.git.groupOutside','native.git.unsupportedWorkspace','native.git.unsupportedSync'].map(key=>({code:'invalid_workspace_path',message:'原始 Git 诊断 /{message}',localized:{schema:'aibo.host-message/v1',key,params:{}}})),
   ...['requestConflict','permissionScope','invalidRequestId','liveLease','approvalSummaryLimit','intentLimit','gitWorkspaceChanged','gitSessionUnavailable','gitTurnUnavailable'].map(key=>({code:'invalid_workspace_path',message:'原始路径诊断 /{message}',localized:reason(key)})),
   ...['storedErrorCode','storedErrorMessage','admissionMissing','storedResultIncompatible'].map(key=>({code:'initialization_error',message:'原始初始化诊断 /{message}',localized:reason(key,{error:'底层解析原文 /{error}'})})),
   ...['noStoredResult','serializationFailed','persistenceFailed','settlementChanged'].map(key=>({code:'outcome_unknown',message:'原始结算诊断 /{message}',localized:{schema:'aibo.host-message/v1',key:'native.error.writeOutcomeUnknown',params:{error:reason(key,{id:'写入标识原文 /{id}',error:'底层结算原文 /{error}'})}}})),
   ...['denied','stale','cancelled','unavailable','expired'].map(decision=>({code:'approval_rejected',message:'原始审批诊断 /{message}',localized:reason('approvalRejected',{decision:reason(decision)})})),
   {code:'approval_rejected',message:'原始恢复诊断 /{message}',localized:reason('restartApproval')},
   {code:'outcome_unknown',message:'原始恢复诊断 /{message}',localized:reason('restartSettlement')},
  ];
  for(const [key,zh,en,error] of [
   ['native.git.noStagedChanges','没有已暂存的更改可提交','There are no staged changes to commit.'],
   ['native.git.emptyCommit','提交信息不能为空','The commit message cannot be empty.'],
   ['native.turn.pathRelative','回合 Git 文件路径必须是工作区内的相对路径。','Turn Git paths must be relative to the workspace.'],
   ['native.turn.restoreCancelled','整文件还原已在替换文件前取消','Whole-file restoration was cancelled before replacing the file.'],
   ['native.turn.restoreFileChanged','文件已在准备恢复期间变化，拒绝覆盖','The file changed while restoration was being prepared. Overwriting it is blocked.'],
   ['native.error.writeOutcomeUnknown','写入结果未知，请核对实际更改后再操作：Git commit 已停止，部分更改可能已生效。\n原文 {output}','The write result is unknown. Check the actual changes before continuing: Git commit stopped; some changes may already have taken effect.\n原文 {output}'],
   ['native.git.truncatedOutput','原文 {output}\n… Git 输出已截断','原文 {output}\n… Git output truncated'],
   ...ledgerErrors.map(error=>[error.localized.key,translateMessage('zh-CN',error.localized),translateMessage('en',error.localized),error]),
  ]){
   await page.evaluate(({key,error})=>{window.validationKey=key;window.validationFailure=error??null;},{key,error});
   await field().fill('原文提交 {message}');await scope.getByRole('button',{name:'提交',exact:true}).click();
   await page.getByText(zh,{exact:true}).waitFor();
   const writes=await page.evaluate(()=>window.validationCalls.filter(call=>call.command==='commit_workspace_changes').length);
   const request=await page.evaluate(()=>window.validationCalls.filter(call=>call.command==='commit_workspace_changes').at(-1).args);
   assert.equal(request.workspaceId,'w');assert.equal(request.repositoryId,'repo');assert.equal(request.message,'原文提交 {message}');
   await page.evaluate(async()=>{const {language}=await import('/src/lib/i18n/runtime.ts');language.set({preference:'en',locale:'en'});});
   await page.getByText(en,{exact:true}).waitFor();
   assert.equal(await scope.getByRole('textbox',{name:/^Commit/}).first().inputValue(),'原文提交 {message}');
   assert.equal(await page.evaluate(()=>window.validationCalls.filter(call=>call.command==='commit_workspace_changes').length),writes);
   if(error)assert.deepEqual(await page.evaluate(()=>window.validationFailure),error);
   if(config.pkg)assert.equal(await page.locator('.presentation-external iframe').first().getAttribute('data-probe-identity'),'same');
   await page.evaluate(async()=>{const {language}=await import('/src/lib/i18n/runtime.ts');language.set({preference:'zh-CN',locale:'zh-CN'});});await page.getByText(zh,{exact:true}).waitFor();
   if(error)assert.deepEqual(await page.evaluate(()=>window.validationFailure),error);
   if(config.pkg)await page.waitForTimeout(250);
  }
  assert.deepEqual(errors,[]);await page.close();console.log(config.kit+'/'+config.theme+'/'+(config.pkg?.release.manifest.id??'builtin')+': native Git validation switches language, retains drafts and does not repeat writes');
 }
}finally{await browser.close();await server.close();await skins.dispose();}
