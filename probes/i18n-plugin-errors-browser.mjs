import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {translateMessage} from '../packages/i18n/index.js';
const catalog=JSON.parse(readFileSync(new URL('../packages/i18n/locales/en.json',import.meta.url),'utf8'));
const undoKeys=['native.plugin.undoInUse','native.plugin.undoUnavailable'];
const keys=Object.keys(catalog).filter(key=>key.startsWith('native.plugin.')||key.startsWith('native.manifest.')||key.startsWith('native.storage.'));
const storageKeys=Object.keys(catalog).filter(key=>key.startsWith('native.storage.'));
const enableKeys=Object.keys(catalog).filter(key=>key.startsWith('native.registry.')||key.startsWith('native.packageDependency.'));
const paramsFor=key=>key==='native.registry.activationRejected'?{reasons:{kind:'list',items:[{key:'native.activation.hostVersion',params:{}},{key:'native.activation.sdkVersion',params:{version:'0.1.8'}}]}}:key==='native.registry.packageDependencyUnavailable'?{plugin:'依赖原文 {plugin}',reason:{key:'native.packageDependency.disabled',params:{}}}:key.endsWith('candidateBinding')?{contribution:'原文{contribution}'}:key.endsWith('capabilityMissing')?{required:'turn.send'}:key.endsWith('sessionBusy')?{label:'原始会话 {label}'}:['native.plugin.upgradeFailed','native.plugin.migrationFailed'].includes(key)?{label:'原始会话 {label}',reason:{key:'native.plugin.identityChanged',params:{}}}:key.endsWith('blocked')?{reasons:{kind:'list',items:[{key:'native.plugin.running',params:{}},{key:'native.plugin.candidates',params:{}}]}}:{};
const server=await createServer({server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false,watch:null}});await server.listen();
const browser=await chromium.launch({headless:true});
try {
 for(const kitId of ['material3','ak-ui'])for(const themeId of ['light','dark']){
  const page=await browser.newPage({viewport:{width:1280,height:900}});page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(60000);const errors=[];page.on('pageerror',error=>errors.push(error.stack??error.message));
  await page.addInitScript(({kitId,themeId})=>{
   if(window!==window.top)return;
   localStorage.setItem('aibo.language.v1','zh-CN');localStorage.setItem('aibo.appearance.v1',JSON.stringify({kitId,themeId}));
   let callback=0;window.pluginErrorCalls=[];
   const installed={id:'old',pluginId:'third.party',pluginVersion:'1.0.0',installed:true,enabled:false,runnable:true,dependencies:[],contributions:[],manifest:{displayName:'插件原文'}};
   window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback(fn){const id=++callback;window['_'+id]=fn;return id},unregisterCallback(id){delete window['_'+id]},async invoke(command,args={}){
    window.pluginErrorCalls.push({command,args});
    if(command.startsWith('plugin:event|'))return 1;
    if(command==='get_app_snapshot')return {platform:'macos',appVersion:'probe',workspaceCount:0,diagnostics:[]};
    if(command==='plugin:dialog|open')return '/package';
    if(command==='list_plugin_installations')return [installed];
    if(command==='list_plugin_undo_targets'){if(window.cleanupErrorKey)throw {message:'清理原始诊断',localized:{schema:'aibo.host-message/v1',key:window.cleanupErrorKey,params:{}}};return ['old'];}
    if(command==='preview_plugin_install')return {pluginId:'third.party',version:'2.0.0',kind:'upgrade',previous:['1.0.0'],token:'fixed-install-token',impacts:[],blockers:[]};
    if(command==='preview_plugin_removal')return {id:'old',token:'fixed-removal-token',sessions:[],bindings:[],dependencies:[],active:0,targets:[]};
    if(['install_agent_plugin','uninstall_agent_plugin','set_agent_plugin_enabled','undo_plugin_replacement'].includes(command))throw {message:'原始诊断',localized:{schema:'aibo.host-message/v1',key:window.pluginErrorKey,params:window.pluginErrorParams}};
    if(command==='read_workspace_preferences')return {trustNewWorkspaces:true};
    if(command==='read_host_confirmation_preferences')return {git:'always-allow',projectAction:'always-allow',turnRestore:'always-allow',capabilityWrite:'always-allow',viewWrite:'always-allow'};
    if(command==='get_presentation_selection'||command==='get_turn_change_set')return null;
    return [];
   }};
  },{kitId,themeId});
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
  await page.locator('[data-host-navigation="management"]').click();const dialog=page.getByRole('dialog');await dialog.getByRole('tab',{name:'插件与能力',exact:true}).click();
  const language=locale=>page.evaluate(async locale=>{const {language}=await import('/src/lib/i18n/runtime.ts');language.set({preference:locale,locale});},locale);
  const operations=[...enableKeys.map(key=>({key,command:'set_agent_plugin_enabled'})),...keys.filter(key=>!undoKeys.includes(key)).map(key=>({key,command:'install_agent_plugin'})),...undoKeys.map(key=>({key,command:'undo_plugin_replacement'})),...storageKeys.map(reason=>({key:'native.plugin.upgradeFailed',command:'install_agent_plugin',params:{label:'原始会话 {label}',reason:{key:reason,params:{}}}})),...['removalChanged','removalDependency','removalHistoryChoice','removalDisabled','uninstalled'].map(key=>({key:'native.plugin.'+key,command:'uninstall_agent_plugin'}))];
  for(const {key,command,params:providedParams} of operations){
   const params=providedParams??paramsFor(key);await page.evaluate(({key,params})=>{window.pluginErrorKey=key;window.pluginErrorParams=params;},{key,params});
   if(command==='install_agent_plugin'){
    await dialog.getByRole('button',{name:'选择目录安装',exact:true}).click();await dialog.getByRole('button',{name:'确认安装',exact:true}).click();
   }else if(command==='set_agent_plugin_enabled'){
    await dialog.getByRole('button',{name:'插件原文 · 1.0.0',exact:true}).click();await dialog.getByRole('button',{name:'启用插件',exact:true}).click();
   }else if(command==='undo_plugin_replacement'){
    await dialog.getByRole('button',{name:'插件原文 · 1.0.0',exact:true}).click();await dialog.getByRole('button',{name:'撤销本次升级',exact:true}).click();
   }else{
    await dialog.getByRole('button',{name:'卸载插件',exact:true}).click();await dialog.getByRole('button',{name:'卸载并清除数据',exact:true}).click();
   }
   const zh=translateMessage('zh-CN',{key,params}),en=translateMessage('en',{key,params});
   await dialog.getByRole('alert').filter({hasText:zh}).waitFor();
   const calls=await page.evaluate(()=>window.pluginErrorCalls.filter(call=>['preview_plugin_install','preview_plugin_removal','install_agent_plugin','uninstall_agent_plugin','set_agent_plugin_enabled','undo_plugin_replacement'].includes(call.command)));
   const request=calls.filter(call=>call.command===command).at(-1).args;
   assert.deepEqual(request,command==='undo_plugin_replacement'?{id:'old'}:command==='set_agent_plugin_enabled'?{id:'old',enabled:true}:command==='install_agent_plugin'?{path:'/package',token:'fixed-install-token',reinstall:false,skipArchived:true}:{id:'old',token:'fixed-removal-token',keepHistory:false});
   await language('en');await dialog.getByRole('alert').filter({hasText:en}).waitFor();await dialog.getByRole('button',{name:'插件原文 · 1.0.0',exact:true}).waitFor();
   assert.deepEqual(await page.evaluate(()=>window.pluginErrorCalls.filter(call=>['preview_plugin_install','preview_plugin_removal','install_agent_plugin','uninstall_agent_plugin','set_agent_plugin_enabled','undo_plugin_replacement'].includes(call.command))),calls);
   await language('zh-CN');await dialog.getByRole('alert').filter({hasText:zh}).waitFor();
   assert.deepEqual(await page.evaluate(()=>window.pluginErrorCalls.filter(call=>['preview_plugin_install','preview_plugin_removal','install_agent_plugin','uninstall_agent_plugin','set_agent_plugin_enabled','undo_plugin_replacement'].includes(call.command))),calls);
  }
  for(const key of ['native.registry.storagePath','native.registry.storageDirectory','native.registry.unknown']){
   await page.evaluate(key=>{window.cleanupErrorKey=key;window.dispatchEvent(new Event('focus'));},key);
   const zh=catalog[key]?translateMessage('zh-CN',{key,params:{}}):'清理原始诊断';
   const en=catalog[key]?translateMessage('en',{key,params:{}}):'清理原始诊断';
   await dialog.getByRole('alert').filter({hasText:zh}).waitFor();
   const calls=await page.evaluate(()=>window.pluginErrorCalls.filter(call=>call.command==='list_plugin_undo_targets'));
   assert.deepEqual(calls.at(-1).args,{});
   await language('en');await dialog.getByRole('alert').filter({hasText:en}).waitFor();
   assert.deepEqual(await page.evaluate(()=>window.pluginErrorCalls.filter(call=>call.command==='list_plugin_undo_targets')),calls);
   await language('zh-CN');await dialog.getByRole('alert').filter({hasText:zh}).waitFor();
   assert.deepEqual(await page.evaluate(()=>window.pluginErrorCalls.filter(call=>call.command==='list_plugin_undo_targets')),calls);
  }
  assert.deepEqual(errors,[]);await page.close();console.log(`${kitId}/${themeId}: cleanup list errors and ${operations.length} native plugin errors translate with unchanged tokens, plugin text and execution counts`);
 }
}finally{await browser.close();await server.close();}
