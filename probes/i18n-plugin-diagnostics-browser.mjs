import assert from 'node:assert/strict';
import {catalogs} from '../packages/i18n/index.js';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {translateMessage} from '../packages/i18n/index.js';
const diagnostics=['executableMissing','nodeMissing','probeFailed','probeTimeout','versionMissing','versionMismatch','versionRangeInvalid'].map(key=>({key:'native.dependency.'+key,params:key==='versionMismatch'?{range:'>=999 {range}'}:{}}));
const activationDiagnostics=[
 {key:'native.activation.retired',params:{}},
 {key:'native.activation.hostVersion',params:{}},
 {key:'native.activation.sdkVersion',params:{version:'0.1.8'}},
 {key:'native.activation.unsupported',params:{id:'贡献 {id}',kind:'capabilityProvider',operation:'操作 {operation}'}},
 {key:'native.activation.unsupported',params:{id:'semantic {id}',kind:'semanticView',operation:{key:'native.activation.noOperation',params:{}}}},
 {key:'native.activation.presentation',params:{id:'presentation {id}'}},
];
const packageDiagnostics=Object.keys(catalogs.en).filter(key=>key.startsWith('native.packageDependency.')).map(key=>({key,params:{}}));
const server=await createServer({server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false,watch:null}});await server.listen();
const browser=await chromium.launch({headless:true});
try {
 for(const kitId of ['material3','ak-ui'])for(const themeId of ['light','dark']){
  const page=await browser.newPage({viewport:{width:1280,height:900}});page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',error=>errors.push(error.stack??error.message));
  await page.addInitScript(({kitId,themeId,diagnostics,activationDiagnostics,packageDiagnostics})=>{
   if(window!==window.top)return;
   localStorage.setItem('aibo.language.v1','zh-CN');localStorage.setItem('aibo.appearance.v1',JSON.stringify({kitId,themeId}));
   let callback=0;window.pluginErrorCalls=[];
   const installed={id:'old',pluginId:'third.party',pluginVersion:'1.0.0',installed:true,enabled:true,runnable:false,packageDependencies:{unavailableContributions:['raw.contribution'],dependencies:packageDiagnostics.map((diagnostic,index)=>({pluginId:`依赖原文.${index}`,required:index===0,available:false,installationId:'pinned',version:'1.2.3',issue:'原始包依赖诊断',localizedIssue:{schema:'aibo.host-message/v1',...diagnostic}}))},activationIssues:activationDiagnostics.map(()=>'原始激活诊断').concat(['插件激活原文']),localizedActivationIssues:activationDiagnostics.map(diagnostic=>({schema:'aibo.host-message/v1',...diagnostic})).concat([null]),dependencies:diagnostics.map(({key,params},index)=>({kind:'executable',name:`第三方程序 {name} ${index}`,required:index===0,available:false,issue:'原始诊断',localizedIssue:{schema:'aibo.host-message/v1',key,params}})).concat([{kind:'executable',name:'raw-provider',required:false,available:false,issue:'version probe failed 原文'}]),contributions:[],manifest:{displayName:'插件原文'}};
   window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback(fn){const id=++callback;window['_'+id]=fn;return id},unregisterCallback(id){delete window['_'+id]},async invoke(command,args={}){
    window.pluginErrorCalls.push({command,args});
    if(command.startsWith('plugin:event|'))return 1;
    if(command==='get_app_snapshot')return {platform:'macos',appVersion:'probe',workspaceCount:0,diagnostics:[]};
    if(command==='plugin:dialog|open')return '/package';
    if(command==='list_plugin_installations')return [installed];
    if(command==='preview_plugin_install')return {pluginId:'third.party',version:'2.0.0',kind:'upgrade',previous:['1.0.0'],token:'fixed-install-token',impacts:[],blockers:[]};
    if(command==='preview_plugin_removal')return {id:'old',token:'fixed-removal-token',sessions:[],bindings:[],dependencies:[],active:0,targets:[]};
    if(['install_agent_plugin','uninstall_agent_plugin'].includes(command))throw {message:'原始诊断',localized:{schema:'aibo.host-message/v1',key:window.pluginErrorKey,params:window.pluginErrorParams}};
    if(command==='read_workspace_preferences')return {trustNewWorkspaces:true};
    if(command==='read_host_confirmation_preferences')return {git:'always-allow',projectAction:'always-allow',turnRestore:'always-allow',capabilityWrite:'always-allow',viewWrite:'always-allow'};
    if(command==='get_presentation_selection'||command==='get_turn_change_set')return null;
    return [];
   }};
  },{kitId,themeId,diagnostics,activationDiagnostics,packageDiagnostics});
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
  await page.locator('[data-host-navigation="management"]').click();const dialog=page.getByRole('dialog');await dialog.getByRole('tab',{name:'插件与能力',exact:true}).click();
  const language=locale=>page.evaluate(async locale=>{const {language}=await import('/src/lib/i18n/runtime.ts');language.set({preference:locale,locale});},locale);
  await dialog.getByRole('button',{name:'插件原文 · 1.0.0',exact:true}).click();
  const calls=await page.evaluate(()=>window.pluginErrorCalls.filter(call=>call.command==='list_plugin_installations'));
  for(const locale of ['zh-CN','en','zh-CN']) {
   await language(locale);
   for(const [index,diagnostic] of diagnostics.entries()) await dialog.getByText(`第三方程序 {name} ${index}`,{exact:false}).filter({hasText:translateMessage(locale,diagnostic)}).waitFor();
   for(const [index,diagnostic] of packageDiagnostics.entries()) await dialog.getByText(`依赖原文.${index}`,{exact:false}).filter({hasText:translateMessage(locale,diagnostic)}).waitFor();
   for(const diagnostic of activationDiagnostics) await dialog.getByText(translateMessage(locale,diagnostic),{exact:true}).waitFor();
   await dialog.getByText('插件激活原文',{exact:true}).waitFor();
   await dialog.getByText('version probe failed 原文',{exact:false}).waitFor();
   for(let index=0;index<diagnostics.length;index++)await dialog.getByText(`第三方程序 {name} ${index}`,{exact:false}).waitFor();
   assert.deepEqual(await page.evaluate(()=>window.pluginErrorCalls.filter(call=>call.command==='list_plugin_installations')),calls);
   assert.equal(await page.evaluate(()=>window.pluginErrorCalls.filter(call=>['set_agent_plugin_enabled','install_agent_plugin','uninstall_agent_plugin'].includes(call.command)).length),0);
  }
  assert.deepEqual(errors,[]);await page.close();console.log(`${kitId}/${themeId}: dependency and activation diagnostics translate with raw names and no repeated probes or writes`);
 }
}finally{await browser.close();await server.close();}
