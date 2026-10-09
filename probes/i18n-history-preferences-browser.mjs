import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {translateMessage} from '../packages/i18n/index.js';
import {buildPresentationSkins} from './lib/build-presentation-skins.mjs';
const skins=await buildPresentationSkins();
const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false,watch:null},plugins:[{
 name:'observe-host-reads',enforce:'pre',transform(code,id){
  if(!id.endsWith('/src/App.svelte'))return;
  const marker='  const capabilityWorkbenchDirectory =';assert.ok(code.includes(marker));
  return code.replace(marker,`  if(typeof window!=='undefined')Object.assign(window,{openReadHistoryFixture(){openExecutionHistory();},openAuditHistoryFixture(){openCapabilityHistory();},closeReadHistoryFixture(){closeHostPanel();},inspectReadFixture(){return JSON.parse(JSON.stringify({history:executionHistory,audit:capabilityHistory,preferences:hostConfirmation,workspace:selectedWorkspaceId,session:selectedSessionId}));}});\n${marker}`);
 }
}]});await server.listen();
const browser=await chromium.launch({headless:true});
try{
 const configs=['material3','ak-ui'].flatMap(kit=>['light','dark'].map(theme=>({kit,theme,pkg:null})));
 for(const pkg of skins.packages)configs.push({kit:'material3',theme:'light',pkg});
 for(const config of configs){
  const page=await browser.newPage({viewport:{width:1280,height:1000}});page.setDefaultTimeout(15000);
  const errors=[];page.on('pageerror',error=>errors.push(error.stack??error.message));
  await page.addInitScript(({kit,theme,pkg})=>{
   if(window!==window.top)return;
   // History's independent timer is tested separately; isolate locale-triggered reads.
   const timeout=window.setTimeout.bind(window);window.setTimeout=(callback,delay,...args)=>timeout(delay===750?()=>{}:callback,delay,...args);
   localStorage.setItem('aibo.language.v1','zh-CN');localStorage.setItem('aibo.appearance.v1',JSON.stringify({kitId:kit,themeId:theme}));
   window.readCalls=[];let callback=0;
   const preferences={git:'always-allow',projectAction:'always-allow',turnRestore:'always-allow',capabilityWrite:'always-allow',viewWrite:'always-allow'};
   window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback(fn){const id=++callback;window['_'+id]=fn;return id},unregisterCallback(id){delete window['_'+id]},async invoke(command,args={}){
    window.readCalls.push({command,args});
    if(window.nativeReadFailure?.command===command)throw window.nativeReadFailure.error;
    if(command.startsWith('plugin:event|'))return 1;
    if(command==='get_app_snapshot')return {platform:'macos',appVersion:'probe',workspaceCount:1,diagnostics:[]};
    if(command==='list_workspaces')return [{id:'w',label:'工作区原文 {label}',path:'/原文/{workspace}',trust:'trusted',createdAt:'now',updatedAt:'now'}];
    if(command==='read_workspace_preferences')return {trustNewWorkspaces:true};
    if(command==='read_host_confirmation_preferences'||command==='save_host_confirmation_preference')return preferences;
    if(command==='get_workspace_changes')return {workspaceId:'w',dirty:false,files:[],captureStatus:'captured'};
    if(command==='list_workspace_git_repositories')return {repositories:[],limited:false,warnings:[]};
    if(command==='inspect_workspace_capabilities')return {workspaceId:'w',instructions:[],skills:[],tools:[],mcpServers:[],warnings:[]};
    if(command==='get_presentation_selection')return pkg?{digest:pkg.release.digest,themeId:pkg.release.manifest.themes[0].id}:null;
    if(command==='list_presentation_packages')return pkg?[pkg.release]:[];
    if(command==='read_presentation_package')return pkg;
    if(command==='get_composer_draft'||command==='get_turn_change_set')return null;
    if(command==='list_capability_history_scopes')return {schema:'aibo.capability-history-scopes/v1',source:args.legacy?'legacy':'events',items:[{scope:{kind:'workspace',id:'w'},label:'范围原文 {scope}'}],nextBefore:null};
    if(command==='read_capability_history')return {schema:'aibo.capability-history-events/v1',source:args.legacy?'legacy':'events',scope:args.scope,events:[],nextBefore:null};
    return [];
   }};
  },config);
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
  await page.waitForFunction(()=>typeof window.inspectReadFixture==='function'&&window.readCalls.some(call=>call.command==='list_workspaces'));
  if(config.pkg)await page.locator('.presentation-external iframe').first().waitFor();
  const frame=config.pkg?await page.locator('.presentation-external iframe').first().elementHandle():null;
  const language=async locale=>{await page.evaluate(async locale=>{const {language}=await import('/src/lib/i18n/runtime.ts');language.set({preference:locale,locale});},locale);if(config.pkg)await page.waitForTimeout(250);};
  const descriptor=key=>({schema:'aibo.host-message/v1',key,params:{}});
  const failure=key=>({code:key==='native.audit.persistedScope'?'initialization_error':'invalid_workspace_path',message:'诊断原文 /{message}',localized:descriptor(key)});
  const calls=()=>page.evaluate(()=>window.readCalls.filter(call=>['list_project_action_runs','list_workspace_write_runs','list_capability_history_scopes','read_capability_history','read_host_confirmation_preferences','save_host_confirmation_preference'].includes(call.command)));
  const stable=async(expected,error)=>{
   await page.getByText(expected('zh-CN'),{exact:true}).waitFor();
   const before=await page.evaluate(()=>window.inspectReadFixture()),beforeCalls=await calls();
   for(const locale of ['en','zh-CN']){
    await language(locale);await page.getByText(expected(locale),{exact:true}).waitFor();
    assert.deepEqual(await page.evaluate(()=>window.inspectReadFixture()),before);assert.deepEqual(await calls(),beforeCalls);
    assert.deepEqual(await page.evaluate(()=>window.nativeReadFailure.error),error);
    assert.equal(before.workspace,'w');assert.equal(before.session,null);
    if(frame)assert.equal(await frame.evaluate(node=>node.isConnected),true);
   }
  };
  await page.evaluate(()=>window.openReadHistoryFixture());
  await page.locator('[data-ui-component="execution-history"]').waitFor();
  for(const command of ['list_project_action_runs','list_workspace_write_runs']){
   const error=failure('native.execution.cursor');
   await page.evaluate(({command,error})=>window.nativeReadFailure={command,error},{command,error});
   const count=(await calls()).filter(call=>call.command===command).length;
   await page.getByRole('button',{name:'刷新记录',exact:true}).click();
   const expected=locale=>translateMessage(locale,{key:command==='list_project_action_runs'?'execution.readTasksFailed':'execution.readWritesFailed',params:{error:error.localized}});
   await stable(expected,error);assert.equal((await calls()).filter(call=>call.command===command).length,count+1);
  }
  await page.evaluate(()=>{window.nativeReadFailure=null;window.openAuditHistoryFixture();});
  await page.getByRole('button',{name:'刷新作用域',exact:true}).waitFor();
  for(const [command,key] of [['list_capability_history_scopes','native.audit.cursor'],['read_capability_history','native.audit.scope'],['list_capability_history_scopes','native.audit.persistedScope']]){
   const error=failure(key);await page.evaluate(({command,error})=>window.nativeReadFailure={command,error},{command,error});
   const count=(await calls()).filter(call=>call.command===command).length;
   await page.getByRole('button',{name:'刷新作用域',exact:true}).click();
   await stable(locale=>translateMessage(locale,error.localized),error);
   assert.equal((await calls()).filter(call=>call.command===command).length,count+1);
  }
  await page.evaluate(()=>{window.nativeReadFailure=null;window.closeReadHistoryFixture();});
  for(const [command,key] of [['read_host_confirmation_preferences','native.confirm.invalidPolicy'],['save_host_confirmation_preference','native.confirm.missingPreference']]){
   const error={code:'initialization_error',message:'原始确认设置诊断 /{policy}',localized:descriptor(key)};
   await page.evaluate(({command,error})=>window.nativeReadFailure={command,error},{command,error});
   await page.getByRole('button',{name:/^打开工作台设置/}).click();
   const dialog=page.getByRole('dialog');await dialog.getByRole('tab',{name:'工作区',exact:true}).click();
   if(command==='save_host_confirmation_preference'){
    await dialog.getByRole('combobox',{name:'Git 操作确认策略',exact:true}).click();
    await page.getByRole('option',{name:'每次询问',exact:true}).click();
   }
   await stable(locale=>translateMessage(locale,error.localized),error);
   const state=await page.evaluate(()=>window.inspectReadFixture().preferences);
   if(command==='save_host_confirmation_preference'){
    assert.equal(state.value.git,'always-allow');assert.equal(state.saving,false);
    const request=(await calls()).filter(call=>call.command===command).at(-1).args;assert.deepEqual(request,{category:'git',policy:'ask'});
   }else assert.equal(state.value,null);
   await page.evaluate(()=>window.nativeReadFailure=null);await dialog.getByRole('button',{name:'重新读取确认设置',exact:true}).click();
   await page.waitForFunction(()=>window.inspectReadFixture().preferences.error===null&&window.inspectReadFixture().preferences.value?.git==='always-allow');
   await page.keyboard.press('Escape');
  }
  assert.deepEqual(errors,[]);await page.close();console.log(`${config.kit}/${config.theme}/${config.pkg?.release.manifest.id??'builtin'}: history and confirmation errors switch language, state and scopes unchanged, no repeated reads or preference writes, explicit reload recovers`);
 }
}finally{await browser.close();await server.close();await skins.dispose();}
