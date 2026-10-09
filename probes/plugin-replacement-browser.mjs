import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const catalogs=Object.fromEntries(['en','zh-CN'].map(locale=>[locale,JSON.parse(readFileSync(new URL(`../packages/i18n/locales/${locale}.json`,import.meta.url),'utf8'))]));
import {createServer} from 'vite';
import {chromium} from 'playwright';
const server=await createServer({server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false,watch:null}});await server.listen();
const browser=await chromium.launch({headless:true});
try {
for(const kitId of ['material3','ak-ui'])for(const themeId of ['light','dark']){
 const page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(({kitId,themeId})=>{
  localStorage.setItem('aibo.appearance.v1',JSON.stringify({kitId,themeId}));
  let callback=0,current={id:'old',pluginId:'third.party',pluginVersion:'1.0.0',installed:true,enabled:true,runnable:true,dependencies:[],contributions:[],manifest:{displayName:'Third Party'}},undo=[];
  window.installKind='upgrade';window.calls=[];
  window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback(fn){const id=++callback;window['_'+id]=fn;return id;},unregisterCallback(id){delete window['_'+id];},async invoke(command,args={}){
   window.calls.push({command,args});
   if(command.startsWith('plugin:event|'))return 1;
   if(command==='plugin:dialog|open')return '/package';
   if(command==='get_app_snapshot')return {platform:'macos',appVersion:'probe',workspaceCount:0,diagnostics:[]};
   if(command==='list_plugin_installations')return [current];
   if(command==='list_plugin_undo_targets')return undo;
   if(command==='preview_plugin_install')return {pluginId:'third.party',version:window.installKind==='downgrade'?'0.5.0':'2.0.0',kind:window.installKind,previous:[current.pluginVersion],token:'reviewed',archivedSessions:['archived'],rebuildSessions:['s'],blockers:window.blockerKey?['原始阻止诊断']:[],localizedBlockers:window.blockerKey?[{schema:'aibo.host-message/v1',key:window.blockerKey,params:{}}]:[],impacts:[{id:current.id,sessions:[{id:'s',label:'Important history'},{id:'archived',label:'Archived history'}],bindings:[],dependencies:[],active:0,targets:[]}]};
   if(command==='install_agent_plugin'){if(args.token!=='reviewed')throw Error('unreviewed');if(window.installKind==='downgrade'&&!args.reinstall)throw Error('unsafe downgrade');current={...current,id:'new',pluginVersion:args.reinstall?'0.5.0':'2.0.0',enabled:!args.reinstall};undo=args.reinstall?[]:['new'];return current;}
   if(command==='undo_plugin_replacement'){current={...current,id:'old',pluginVersion:'1.0.0'};undo=[];return;}
   if(command==='read_workspace_preferences')return {trustNewWorkspaces:true};
   if(command==='read_host_confirmation_preferences')return {git:'always-allow',projectAction:'always-allow',turnRestore:'always-allow',capabilityWrite:'always-allow',viewWrite:'always-allow'};
   if(command==='get_presentation_selection'||command==='get_turn_change_set')return null;
   return [];
  }};
 },{kitId,themeId});
 await page.addInitScript(()=>{if(window===window.top&&location.protocol==='http:')localStorage.setItem('aibo.language.v1','zh-CN')});
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
 await page.getByRole('button',{name:'插件与能力',exact:true}).click();
 const dialog=page.getByRole('dialog');
 await page.getByRole('dialog',{name:'工作台设置',exact:true}).waitFor();
 const impact=dialog.locator('section.plugin-details').filter({has:page.getByRole('heading',{level:3,name:/ · third\.party$/})});
 for(const key of ['running','dependencies','candidates','historicalInstalls'].map(key=>'native.plugin.'+key)){
  await page.evaluate(key=>window.blockerKey=key,key);
  await dialog.getByRole('button',{name:'选择目录安装',exact:true}).click();
  await dialog.getByRole('alert').filter({hasText:catalogs['zh-CN'][key]}).waitFor();
  assert.equal(await impact.getByRole('button',{name:'确认安装',exact:true}).isDisabled(),true);
  const reads=await page.evaluate(()=>window.calls.filter(call=>call.command==='preview_plugin_install').length);
  await page.evaluate(async()=>{const {language}=await import('/src/lib/i18n/runtime.ts');language.set({preference:'en',locale:'en'})});
  await dialog.getByRole('alert').filter({hasText:catalogs.en[key]}).waitFor();
  assert.equal(await impact.getByRole('button',{name:'Confirm installation',exact:true}).isDisabled(),true);
  assert.equal(await page.evaluate(()=>window.calls.filter(call=>call.command==='preview_plugin_install').length),reads);
  assert.equal(await page.evaluate(()=>window.calls.filter(call=>call.command==='install_agent_plugin').length),0);
  await page.evaluate(async()=>{const {language}=await import('/src/lib/i18n/runtime.ts');language.set({preference:'zh-CN',locale:'zh-CN'})});
  await dialog.getByRole('alert').filter({hasText:catalogs['zh-CN'][key]}).waitFor();
  await impact.getByRole('button',{name:'取消',exact:true}).click();
 }
 await page.evaluate(()=>window.blockerKey='');
 await dialog.getByRole('button',{name:'选择目录安装',exact:true}).click();
 await impact.getByText('会话：Important history（可重建）',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.calls.some(c=>c.command==='install_agent_plugin')),false);
 const skip=impact.getByRole('checkbox',{name:'跳过已归档会话（1）',exact:true});
 assert.equal(await skip.isChecked(),true);
 await skip.click();assert.equal(await skip.isChecked(),false);
 await impact.getByRole('button',{name:'确认安装',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.command==='install_agent_plugin').at(-1).args.skipArchived),false);
 await dialog.getByRole('button',{name:'撤销本次升级',exact:true}).click();
 await dialog.getByText('已撤销升级并恢复旧版本。',{exact:true}).waitFor();
 await page.evaluate(()=>window.installKind='installed');await dialog.getByRole('button',{name:'选择目录安装',exact:true}).click();
 await dialog.getByText('已安装相同版本和内容，无需重复安装。',{exact:true}).waitFor();
 await page.evaluate(()=>window.installKind='downgrade');await dialog.getByRole('button',{name:'选择目录安装',exact:true}).click();
 await impact.getByText(/旧版不能安全读取新版数据/).waitFor();
 await impact.getByRole('button',{name:'取消',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.command==='install_agent_plugin').length),1);
 await dialog.getByRole('button',{name:'选择目录安装',exact:true}).click();
 await page.setViewportSize({width:960,height:720});assert.equal(await dialog.locator('.management-content').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
 await page.screenshot({path:`/tmp/aibo-plugin-replacement-${kitId}-${themeId}.png`});
 await impact.getByRole('button',{name:'清除插件数据并安装旧版',exact:true}).click();
 await dialog.getByText('已安装旧版，原会话仅保留历史。启用后可创建新会话。',{exact:true}).waitFor();
 const last=await page.evaluate(()=>window.calls.filter(c=>c.command==='install_agent_plugin').at(-1));assert.equal(last.args.reinstall,true);
 assert.deepEqual(errors,[]);await page.close();console.log(`${kitId}/${themeId}: replacement, undo, duplicate, downgrade confirmation and layout passed`);
}
}finally{await browser.close();await server.close();}
