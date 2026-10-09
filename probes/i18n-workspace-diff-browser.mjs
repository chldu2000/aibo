import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {buildPresentationSkins} from './lib/build-presentation-skins.mjs';
const skins=await buildPresentationSkins();
const server=await createServer({server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false,watch:null},plugins:[{
 name:'diff-i18n-fixture',enforce:'pre',transform(code,id){
  if(!id.endsWith('/src/App.svelte'))return;
  return code.replace('  const gitPresentation =', String.raw`
  if(typeof window !== 'undefined') Object.assign(window,{setDiffScenario(key: string | null){
    git={...git,fileDiffPath:'/用户/{reason}.txt',fileDiff:{path:'/用户/{reason}.txt',staged:false,available:false,truncated:false,diff:'',hunks:[],reason:'原始诊断',...(key?{localizedReason:{schema:'aibo.host-message/v1',key,params:{}}}:{})}};
  },setTruncatedDiffScenario(){const marker='\n… diff 已截断';git={...git,fileDiffPath:'/用户/{suffix}.txt',fileDiff:{path:'/用户/{suffix}.txt',staged:false,available:true,truncated:true,diff:'--- a/raw\n+++ b/raw\n@@ -1 +1 @@\n+原文 {suffix}'+marker,hunks:[],reason:null,localizedSuffix:{schema:'aibo.host-message/v1',key:'native.diff.truncatedSuffix',params:{}}}}},inspectDiffScenario(){return git.fileDiff}});
  const gitPresentation =`);
 }
}]});await server.listen();
const browser=await chromium.launch({headless:true});
try{
 const cases=['material3','ak-ui'].flatMap(kit=>['light','dark'].map(theme=>({kit,theme,pkg:null})));
 for(const pkg of skins.packages)cases.push({kit:'material3',theme:'light',pkg});
 for(const config of cases){
  const page=await browser.newPage({viewport:{width:1280,height:900}});page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(({kit,theme,pkg})=>{
   if(window!==window.top)return;
   localStorage.setItem('aibo.language.v1','zh-CN');localStorage.setItem('aibo.appearance.v1',JSON.stringify({kitId:kit,themeId:theme}));
   let callback=0;window.diffCalls=[];
   window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback(fn){const id=++callback;window['_'+id]=fn;return id},unregisterCallback(id){delete window['_'+id]},async invoke(command,args={}){
    window.diffCalls.push({command,args});
    if(command.startsWith('plugin:event|'))return 1;
    if(command==='get_app_snapshot')return {platform:'macos',appVersion:'probe',workspaceCount:0,diagnostics:[]};
    if(command==='read_workspace_preferences')return {trustNewWorkspaces:true};
    if(command==='get_presentation_selection')return pkg?{digest:pkg.release.digest,themeId:pkg.release.manifest.themes[0].id}:null;
    if(command==='list_presentation_packages')return pkg?[pkg.release]:[];
    if(command==='read_presentation_package')return pkg;
    if(command==='get_turn_change_set')return null;
    return [];
   }};
  },config);
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`,{timeout:60000});
  await page.waitForFunction(()=>Boolean(window.setDiffScenario));
  let scope=page;
  if(config.pkg){await page.locator('.presentation-external iframe').first().waitFor();scope=page.frameLocator('.presentation-external iframe').first();await scope.getByRole('button',{name:'Git',exact:true}).click();await page.locator('.presentation-external iframe').first().evaluate(el=>el.dataset.probeIdentity='same');}
  for(const [key,zh,en] of [
   ['native.diff.binary','二进制文件暂不提供文本 diff','Text diffs are unavailable for binary files.'],
   ['native.diff.untrackedTooLarge','未跟踪文件过大，暂不生成文本 diff','The untracked file is too large to generate a text diff.'],
   ['native.diff.noChanges','当前状态没有可展示的文件变更','There are no file changes to display.'],
   ['native.diff.commitEmpty','该提交中的文件没有可展示的文本差异','This file has no text differences to display in this commit.'],
   [null,'原始诊断','原始诊断'],
   ['native.diff.unknown','原始诊断','原始诊断'],
  ]){
   await page.evaluate(key=>window.setDiffScenario(key),key);await scope.getByText(zh,{exact:true}).waitFor();
   const reads=await page.evaluate(()=>window.diffCalls.filter(call=>call.command.includes('file_diff')).length);
   await page.evaluate(async()=>{const {language}=await import('/src/lib/i18n/runtime.ts');language.set({preference:'en',locale:'en'});});
   await scope.getByText(en,{exact:true}).waitFor();await scope.getByText('/用户/{reason}.txt',{exact:true}).first().waitFor();
   assert.equal(await page.evaluate(()=>window.diffCalls.filter(call=>call.command.includes('file_diff')).length),reads);
   if(config.pkg)assert.equal(await page.locator('.presentation-external iframe').first().getAttribute('data-probe-identity'),'same');
   await page.evaluate(async()=>{const {language}=await import('/src/lib/i18n/runtime.ts');language.set({preference:'zh-CN',locale:'zh-CN'});});await scope.getByText(zh,{exact:true}).waitFor();
  }
  await page.evaluate(()=>window.setTruncatedDiffScenario());
  await scope.getByText('… diff 已截断',{exact:!config.pkg}).first().waitFor();
  const original=await page.evaluate(()=>window.inspectDiffScenario());
  const reads=await page.evaluate(()=>window.diffCalls.filter(call=>call.command.includes('file_diff')).length);
  await page.evaluate(async()=>{const {language}=await import('/src/lib/i18n/runtime.ts');language.set({preference:'en',locale:'en'});});
  await scope.getByText('… diff truncated',{exact:!config.pkg}).first().waitFor();
  await scope.getByText('原文 {suffix}',{exact:!config.pkg}).first().waitFor();
  assert.deepEqual(await page.evaluate(()=>window.inspectDiffScenario()),original);
  assert.equal(await page.evaluate(()=>window.diffCalls.filter(call=>call.command.includes('file_diff')).length),reads);
  if(config.pkg)assert.equal(await page.locator('.presentation-external iframe').first().getAttribute('data-probe-identity'),'same');
  await page.evaluate(async()=>{const {language}=await import('/src/lib/i18n/runtime.ts');language.set({preference:'zh-CN',locale:'zh-CN'});});
  await scope.getByText('… diff 已截断',{exact:!config.pkg}).first().waitFor();
  assert.deepEqual(errors,[]);await page.close();console.log(`${config.kit}/${config.theme}/${config.pkg?.release.manifest.id??'builtin'}: translated diff reasons, legacy fallback, same instance and literal paths passed`);
 }
}finally{await browser.close();await server.close();await skins.dispose();}
