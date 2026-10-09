import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {translateMessage} from '../packages/i18n/index.js';
import {buildPresentationSkins} from './lib/build-presentation-skins.mjs';
const skins=await buildPresentationSkins();
const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false,watch:null},plugins:[{
 name:'observe-workspace-add',enforce:'pre',transform(code,id){
  if(!id.endsWith('/src/App.svelte'))return;
  const marker='  const capabilityWorkbenchDirectory =';assert.ok(code.includes(marker));
  return code.replace(marker,`  if(typeof window!=='undefined')Object.assign(window,{inspectWorkspaceAddFixture(){return JSON.parse(JSON.stringify({workspaces,workspace:selectedWorkspaceId,session:selectedSessionId,busy,error:errorMessage,expanded:expandedWorkspaceIds}));}});\n${marker}`);
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
   localStorage.setItem('aibo.language.v1','zh-CN');localStorage.setItem('aibo.appearance.v1',JSON.stringify({kitId:kit,themeId:theme}));
   const original={id:'w',label:'工作区原文 {label}',path:'/原文/{workspace}',trust:'trusted',createdAt:'now',updatedAt:'now'};
   window.addCalls=[];window.mockWorkspaces=[original];let callback=0;
   window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback(fn){const id=++callback;window['_'+id]=fn;return id},unregisterCallback(id){delete window['_'+id]},async invoke(command,args={}){
    window.addCalls.push({command,args});
    if(command.startsWith('plugin:event|'))return 1;
    if(command==='plugin:dialog|open')return '  /原文/{path}  ';
    if(command==='add_workspace'){
     if(window.workspaceAddFailure)throw window.workspaceAddFailure;
     const workspace={...original,id:'added',path:args.path,label:'新工作区原文 {label}'};
     window.mockWorkspaces=[workspace,original];return workspace;
    }
    if(command==='get_app_snapshot')return {platform:'macos',appVersion:'probe',workspaceCount:1,diagnostics:[]};
    if(command==='list_workspaces')return window.mockWorkspaces;
    if(command==='read_workspace_preferences')return {trustNewWorkspaces:true};
    if(command==='get_workspace_changes')return {workspaceId:args.workspaceId,dirty:false,files:[],captureStatus:'captured'};
    if(command==='list_workspace_git_repositories')return {repositories:[],limited:false,warnings:[]};
    if(command==='inspect_workspace_capabilities')return {workspaceId:args.workspaceId,instructions:[],skills:[],tools:[],mcpServers:[],warnings:[]};
    if(command==='get_presentation_selection')return pkg?{digest:pkg.release.digest,themeId:pkg.release.manifest.themes[0].id}:null;
    if(command==='list_presentation_packages')return pkg?[pkg.release]:[];
    if(command==='read_presentation_package')return pkg;
    if(command==='get_composer_draft'||command==='get_turn_change_set')return null;
    return [];
   }};
  },config);
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
  await page.waitForFunction(()=>typeof window.inspectWorkspaceAddFixture==='function'&&window.inspectWorkspaceAddFixture().workspaces.length===1);
  let scope=page;
  if(config.pkg){await page.locator('.presentation-external iframe').first().waitFor();scope=page.frameLocator('.presentation-external iframe').first();}
  const frame=config.pkg?await page.locator('.presentation-external iframe').first().elementHandle():null;
  const language=async locale=>{await page.evaluate(async locale=>{const {language}=await import('/src/lib/i18n/runtime.ts');language.set({preference:locale,locale});},locale);if(config.pkg)await page.waitForTimeout(250);};
  const calls=()=>page.evaluate(()=>window.addCalls.filter(call=>['plugin:dialog|open','add_workspace'].includes(call.command)));
  const fixtures=['emptyPath','inaccessible','inspectFailed','notDirectory'].map(name=>({code:'invalid_workspace_path',message:'原始工作区诊断 /{message}',localized:{schema:'aibo.host-message/v1',key:'native.workspace.'+name,params:{path:'/原文/{path}',error:'底层 OS 原文 /{error}'}}}));
  fixtures.push({code:'invalid_workspace_path',message:'旧版诊断原文 /{message}'},{code:'invalid_workspace_path',message:'未知词条原文 /{message}',localized:{schema:'aibo.host-message/v1',key:'native.workspace.unknown',params:{}}},{code:'invalid_workspace_path',message:'错误 schema 原文 /{message}',localized:{schema:'other/v1',key:'native.workspace.emptyPath',params:{}}});
  for(const [index,error] of fixtures.entries()){
   await page.evaluate(error=>{window.workspaceAddFailure=error;},error);
   const before=await page.evaluate(()=>window.inspectWorkspaceAddFixture());
   const beforeCalls=await calls();
   await scope.getByRole('button',{name:'添加工作区',exact:true}).click();
   const text=locale=>index<4?translateMessage(locale,error.localized):error.message;
   await page.getByText(text('zh-CN'),{exact:true}).waitFor();
   await page.waitForFunction(()=>!window.inspectWorkspaceAddFixture().busy);
   const state=await page.evaluate(()=>window.inspectWorkspaceAddFixture());
   assert.deepEqual(state.workspaces,before.workspaces);assert.equal(state.workspace,before.workspace);assert.equal(state.session,before.session);assert.deepEqual(state.expanded,before.expanded);
   const requests=await calls();assert.equal(requests.length,beforeCalls.length+2);
   assert.equal(requests.at(-1).command,'add_workspace');assert.deepEqual(requests.at(-1).args,{path:'/原文/{path}'});
   assert.equal(requests.at(-2).command,'plugin:dialog|open');assert.equal(requests.at(-2).args.options.directory,true);
   for(const locale of ['en','zh-CN']){
    await language(locale);await page.getByText(text(locale),{exact:true}).waitFor();
    assert.deepEqual(await page.evaluate(()=>window.inspectWorkspaceAddFixture()),state);
    assert.deepEqual(await calls(),requests);assert.deepEqual(await page.evaluate(()=>window.workspaceAddFailure),error);
    if(frame)assert.equal(await frame.evaluate(el=>el.isConnected),true);
   }
  }
  await page.evaluate(()=>{window.workspaceAddFailure=null;});
  const beforeAdded=await page.evaluate(()=>window.inspectWorkspaceAddFixture());
  const beforeCalls=await calls();await scope.getByRole('button',{name:'添加工作区',exact:true}).click();
  try {await page.waitForFunction(()=>{const state=window.inspectWorkspaceAddFixture();return !state.busy&&state.workspaces.length===2&&state.expanded.includes('added')&&state.error===null;});} catch(error) { console.error(JSON.stringify(await page.evaluate(()=>({state:window.inspectWorkspaceAddFixture(),calls:window.addCalls})),null,2));throw error; }
  const added=await page.evaluate(()=>window.inspectWorkspaceAddFixture());
  assert.equal(added.workspace,beforeAdded.workspace);assert.equal(added.session,beforeAdded.session);assert.ok(added.expanded.includes('added'));
  assert.equal(added.workspaces[0].label,'新工作区原文 {label}');assert.equal(added.workspaces[0].path,'/原文/{path}');
  assert.equal((await calls()).length,beforeCalls.length+2);
  const requests=await calls();await language('en');assert.deepEqual(await page.evaluate(()=>window.inspectWorkspaceAddFixture()),added);assert.deepEqual(await calls(),requests);
  if(frame)assert.equal(await frame.evaluate(el=>el.isConnected),true);
  assert.deepEqual(errors,[]);
  console.log(`${config.kit}/${config.theme}/${config.pkg?.release.manifest.id??'builtin'}: workspace add errors switch language, preserve state and raw parameters, no repeated picker or add, valid retry succeeds`);
  await page.close();
 }
}finally{await browser.close();await server.close();await skins.dispose();}
