import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {buildPresentationSkins} from './lib/build-presentation-skins.mjs';
const skins=await buildPresentationSkins();
const server=await createServer({server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false,watch:null}});await server.listen();
const browser=await chromium.launch({headless:true});
try {
 const cases=['material3','ak-ui'].flatMap(kit=>['light','dark'].map(theme=>({kit,theme,pkg:null})));
 for(const pkg of skins.packages)cases.push({kit:'material3',theme:'light',pkg});
 for(const config of cases){
  const page=await browser.newPage({viewport:{width:1280,height:900}});page.setDefaultTimeout(15000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(({kit,theme,pkg})=>{
   if(window!==window.top)return;
   localStorage.setItem('aibo.language.v1','zh-CN');localStorage.setItem('aibo.appearance.v1',JSON.stringify({kitId:kit,themeId:theme}));
   localStorage.setItem('aibo.selected-session',JSON.stringify({workspaceId:'w',sessionId:'s'}));
   const sessions=['s','other'].map(id=>({id,workspaceId:'w',label:id,agent:'fixture.agent',state:'idle',archived:false,externalSessionId:null,pluginInstallationId:'fixture',capabilities:[],createdAt:'now',updatedAt:'now'}));
   const attachment=(id,path,mediaType,turnId)=>({id,path,mediaType,turnId,schema:'aibo.context-attachment/v1',workspaceId:'w',sessionId:'s',source:'manual',sendStrategy:'reference',createdAt:'now',size:100});
   const attachments=[attachment('image','image.png','image/png','t'),attachment('draft','draft.png','image/png',null),attachment('file','notes.ts','text/plain','t'),attachment('binary','archive.zip','application/zip','t')];
   const content='Message attachments\n[AIBO_CONTEXT_ATTACHMENTS]\n'+attachments.filter(a=>a.turnId).map(a=>`- ${a.path} (${a.mediaType}, 100 bytes) [attachment:${a.id}]`).join('\n')+'\n[/AIBO_CONTEXT_ATTACHMENTS]';
   let callback=0;window.viewerCalls=[];
   window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback(fn){const id=++callback;window['_'+id]=fn;return id;},unregisterCallback(id){delete window['_'+id];},async invoke(command,args={}){
    window.viewerCalls.push({command,args});
    if(command.startsWith('plugin:event|'))return 1;
    if(command==='get_app_snapshot')return {platform:'macos',appVersion:'probe',workspaceCount:1,diagnostics:[]};
    if(command==='list_workspaces')return [{id:'w',path:'/workspace',label:'Workspace',trust:'trusted',createdAt:'now',updatedAt:'now'}];
    if(command==='list_sessions')return sessions;
    if(command==='get_presentation_selection')return pkg?{digest:pkg.release.digest,themeId:pkg.release.manifest.themes[0].id}:null;
    if(command==='list_presentation_packages')return pkg?[pkg.release]:[];
    if(command==='read_presentation_package')return pkg;
    if(command==='list_session_attachments')return args.sessionId==='s'?attachments:[];
    if(command==='get_timeline')return args.sessionId==='s'?[{id:'m',sessionId:'s',turnId:'t',role:'user',content,status:'completed',createdAt:'now',updatedAt:'now'}]:[];
    if(command==='save_session_attachment_image'){
     if(window.saveFailure)throw Error('disk full');
     return window.saveCancelled?null:'/downloads/image.png';
    }
    if(command==='get_session_attachment_preview'){
     if(window.imageFailure)throw Error('Image unavailable');
     if(window.holdImage)await new Promise(resolve=>window.releaseImage=resolve);
     return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
    }
    if(command==='read_linked_file'){
     if(args.path==='archive.zip')throw {code:'session_operation_error',message:'binary',localized:{schema:'aibo.host-message/v1',key:'native.search.binaryPreview',params:{}}};
     return {path:'/workspace/notes.ts',content:'const answer = 42;',startLine:1,totalLines:1,targetLine:1,truncated:false};
    }
    if(command==='get_composer_draft'||command==='get_turn_change_set'||command==='get_session_execution_profile')return null;
    if(command==='save_composer_draft')return {text:args.text,sendFailed:false,updatedAt:'now'};
    if(command==='get_workspace_changes')return {workspaceId:'w',files:[],dirty:false,captureStatus:'captured'};
    if(command==='list_workspace_git_repositories')return {repositories:[],limited:false,warnings:[],scanBudget:2000};
    if(command==='get_workspace_git_remote_status')return {branch:null,upstream:null,ahead:0,behind:0};
    if(command==='inspect_workspace_capabilities')return {workspaceId:'w',instructions:[],skills:[],tools:[],mcpServers:[],warnings:[]};
    if(command==='read_workspace_preferences')return {trustNewWorkspaces:true};
    if(command==='read_session_reference_preferences')return {messageLimit:12};
    return [];
   }};
  },config);
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`,{timeout:60000});
  let scope=page;
  if(config.pkg){await page.locator('.presentation-external iframe').first().waitFor();scope=page.frameLocator('.presentation-external iframe').first();}
  const open=name=>scope.getByRole(config.pkg?'button':'link',{name,exact:true}).first();
  await open('image.png').waitFor();await open('image.png').focus();await page.keyboard.press('Enter');
  const imagePanel=page.getByRole('dialog',{name:'图片预览：image.png',exact:true});
  await imagePanel.locator('img').waitFor();assert.equal(await imagePanel.locator('img').evaluate(img=>img.complete&&img.naturalWidth>0),true);
  await imagePanel.getByRole('button',{name:'原始大小',exact:true}).click();await imagePanel.getByRole('button',{name:'适应窗口',exact:true}).click();
  await imagePanel.getByRole('button',{name:'图片另存为…',exact:true}).click();
  await page.getByText('已保存到 /downloads/image.png',{exact:true}).waitFor();
  const saveCall=await page.evaluate(()=>window.viewerCalls.find(call=>call.command==='save_session_attachment_image'));
  assert.deepEqual(saveCall.args,{sessionId:'s',attachmentId:'image'});
  await page.evaluate(()=>window.saveFailure=true);
  await imagePanel.getByRole('button',{name:'图片另存为…',exact:true}).click();
  await page.getByText(/图片保存失败.*disk full/).waitFor();
  await page.evaluate(()=>{window.saveFailure=false;window.saveCancelled=true;});
  await imagePanel.getByRole('button',{name:'图片另存为…',exact:true}).click();
  await page.evaluate(()=>window.saveCancelled=false);
  await page.keyboard.press('Escape');await imagePanel.waitFor({state:'hidden'});
  await scope.locator('img[alt="image.png"]').first().click();await imagePanel.locator('img').waitFor();await page.keyboard.press('Escape');
  await open('draft.png').click();await page.getByRole('dialog',{name:'图片预览：draft.png',exact:true}).locator('img').waitFor();await page.keyboard.press('Escape');
  await open('notes.ts').click();const filePanel=page.getByRole('complementary',{name:'文件预览',exact:true});await filePanel.getByText('const answer = 42;',{exact:false}).waitFor();await page.keyboard.press('Escape');
  await open('archive.zip').click();await filePanel.getByRole('alert').filter({hasText:'二进制文件不提供文本预览'}).waitFor();await page.keyboard.press('Escape');
  await page.evaluate(()=>window.imageFailure=true);await open('image.png').click();await imagePanel.getByRole('alert').waitFor();
  await page.evaluate(()=>window.imageFailure=false);await imagePanel.getByRole('button',{name:'重试',exact:true}).click();await imagePanel.locator('img').waitFor();await page.keyboard.press('Escape');
  await page.evaluate(()=>window.holdImage=true);await open('image.png').click();await imagePanel.getByRole('status').waitFor();await page.keyboard.press('Escape');
  await page.evaluate(()=>window.releaseImage());await page.waitForTimeout(100);assert.equal(await imagePanel.count(),0);
  assert.deepEqual(errors,[]);console.log(`${config.kit}/${config.theme}/${config.pkg?.release.manifest.id??'builtin'}: image, draft, text, unsupported file, retry and stale close passed`);
  await page.close();
 }
}finally{await browser.close();await server.close();await skins.dispose();}
