import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {translateMessage} from '../packages/i18n/index.js';
import {ownedGuardCases} from './fixtures/ui-owned-guards.mjs';
import {buildPresentationSkins} from './lib/build-presentation-skins.mjs';
const skins=await buildPresentationSkins();
const guardSnapshot=JSON.parse(await readFile('fixtures/semantic-git/collection.json','utf8'));
const catalog=JSON.parse(await readFile(new URL('../packages/i18n/locales/en.json',import.meta.url)));
const scenarios=[...Object.keys(catalog).filter(key=>key.startsWith('native.presentation.')).map(key=>({message:'原始诊断 {path}',localized:{schema:'aibo.host-message/v1',key,params:{}}})),{message:'原始诊断 {path}'},{message:'原始诊断 {path}',localized:{schema:'aibo.host-message/v1',key:'native.presentation.unknown',params:{}}},{message:'原始诊断 {path}',localized:{schema:'invalid',key:'native.presentation.invalidManifest',params:{}}}];
const server=await createServer({server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false,watch:null},plugins:[{name:'owned-ui-guard-observation',enforce:'pre',transform(code,id){
 if(!id.endsWith('/src/App.svelte'))return;
 const marker='  const sessionStartupController =';assert.ok(code.includes(marker));
 return code.replace(marker,`  if(typeof window!=='undefined')Object.assign(window,{
   async runOwnedGuardFixture(kind){await presentationOperation(async()=>{const {exerciseOwnedGuard}=await import('/probes/fixtures/ui-owned-guards.mjs');const result=await exerciseOwnedGuard(kind,${JSON.stringify(guardSnapshot)});window.ownedGuardResult={...result,error:undefined};if(result.error)throw result.error;errorMessage=result.display;});},
   inspectOwnedGuardFixture(){return {result:window.ownedGuardResult,error:errorMessage,busy};}
  });
${marker}`);
}}]});await server.listen();
const browser=await chromium.launch({headless:true});
try{
 const configs=['material3','ak-ui'].flatMap(kitId=>['light','dark'].map(themeId=>({kitId,themeId,pkg:null}))).concat(skins.packages.map(pkg=>({kitId:'material3',themeId:'light',pkg})));
 for(const {kitId,themeId,pkg} of configs){
  const page=await browser.newPage({viewport:{width:1280,height:900}});page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(({kitId,themeId,pkg})=>{
   if(window!==window.top)return;
   localStorage.setItem('aibo.language.v1','zh-CN');localStorage.setItem('aibo.appearance.v1',JSON.stringify({kitId,themeId}));
   let callback=0;window.presentationErrorCalls=[];
   window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback(fn){const id=++callback;window['_'+id]=fn;return id},unregisterCallback(id){delete window['_'+id]},async invoke(command,args={}){
    window.presentationErrorCalls.push({command,args});
    if(command.startsWith('plugin:event|'))return 1;
    if(command==='plugin:dialog|open')return '/原文{path}/presentation';
    if(command==='install_presentation_package')throw window.presentationError;
    if(command==='get_app_snapshot')return {platform:'macos',appVersion:'probe',workspaceCount:0,diagnostics:[]};
    if(command==='read_workspace_preferences')return {trustNewWorkspaces:true};
    if(command==='read_host_confirmation_preferences')return {git:'always-allow',projectAction:'always-allow',turnRestore:'always-allow',capabilityWrite:'always-allow',viewWrite:'always-allow'};
    if(command==='get_presentation_selection')return pkg?{digest:pkg.release.digest,themeId:null}:null;
    if(command==='list_presentation_packages')return pkg?[pkg.release]:[];
    if(command==='read_presentation_package')return pkg;
    return [];
   }};
  },{kitId,themeId,pkg});
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`,{timeout:60000});
  if(pkg)await page.locator('.presentation-external iframe:visible').waitFor();
  await page.locator('[data-host-navigation="management"]').click();const dialog=page.getByRole('dialog');await dialog.getByRole('tab',{name:'插件与能力',exact:true}).click();
  const language=locale=>page.evaluate(async locale=>{const {language}=await import('/src/lib/i18n/runtime.ts');language.set({preference:locale,locale});},locale);
  const calls=()=>page.evaluate(()=>window.presentationErrorCalls.filter(call=>['plugin:dialog|open','install_presentation_package','select_presentation_package','uninstall_presentation_package'].includes(call.command)));
  for(const scenario of scenarios){
   await page.evaluate(value=>{window.presentationError=value},scenario);
   const before=(await calls()).length;
   await dialog.getByRole('button',{name:'安装皮肤插件',exact:true}).click();
   const valid=scenario.localized?.schema==='aibo.host-message/v1'&&catalog[scenario.localized?.key];
   const label=locale=>valid?translateMessage(locale,scenario.localized):scenario.message;
   await page.locator('[role="alert"]').filter({hasText:label('zh-CN')}).waitFor();
   const recorded=await calls();assert.equal(recorded.length,before+2);assert.deepEqual(recorded.at(-1),{command:'install_presentation_package',args:{path:'/原文{path}/presentation'}});
   await language('en');await page.locator('[role="alert"]').filter({hasText:label('en')}).waitFor();assert.deepEqual(await calls(),recorded);
   await language('zh-CN');await page.locator('[role="alert"]').filter({hasText:label('zh-CN')}).waitFor();assert.deepEqual(await calls(),recorded);
   assert.deepEqual(await page.evaluate(()=>window.presentationError),scenario);
  }
  for(const [kind,key] of ownedGuardCases){
   await page.evaluate(kind=>window.runOwnedGuardFixture(kind),kind);
   await page.locator('[role="alert"]').filter({hasText:translateMessage('zh-CN',{key,params:{}})}).waitFor();
   const original=await page.evaluate(()=>window.inspectOwnedGuardFixture());assert.equal(original.busy,false);assert.equal(original.result.display.key,key);
   if(kind==='state'){assert.deepEqual(original.result.canonical.before,original.result.canonical.after);assert.deepEqual(original.result.canonical.restored,original.result.canonical.valid);}
   if(kind==='project'){assert.equal(original.result.canonical.editor.name,'草稿原文');assert.equal(original.result.canonical.editor.open,true);assert.equal(original.result.canonical.editor.enabled,false);assert.equal(original.result.canonical.calls.length,1);}
   if(kind==='diff'){assert.equal(original.result.canonical.state.diff,null);assert.equal(original.result.canonical.response.diff,'provider 原文');assert.deepEqual(original.result.canonical.calls,[['session','turn','原文.txt']]);}
   const requests=await page.evaluate(()=>window.presentationErrorCalls.filter(call=>call.command!=='set_window_locale'));
   for(const locale of ['en','zh-CN']){
    await language(locale);await page.locator('[role="alert"]').filter({hasText:translateMessage(locale,{key,params:{}})}).waitFor();
    assert.deepEqual(await page.evaluate(()=>window.inspectOwnedGuardFixture()),original);
    assert.deepEqual(await page.evaluate(()=>window.presentationErrorCalls.filter(call=>call.command!=='set_window_locale')),requests);
   }
  }
  assert.deepEqual(errors,[]);await page.close();console.log(`${kitId}/${themeId}/${pkg?.release.manifest.id??'builtin'}: ${scenarios.length} native and ${ownedGuardCases.length} owned presentation errors switch language with raw fallback and unchanged requests`);
 }
}finally{await browser.close();await server.close();await skins.dispose();}
