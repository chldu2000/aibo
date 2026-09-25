import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright';
const server=await createServer({cacheDir:'/tmp/aibo-startup-browser-vite',server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false,watch:null},plugins:[{
 name:'startup-actions',enforce:'pre',transform(code,id){
  if(!id.endsWith('/src/App.svelte'))return;
  return code.replace('</script>', `
    if (typeof window !== 'undefined') window.startupActions = {
      create: () => createPluginSession('provider', 'external.agent', 'w'),
      select: id => navigationController.selectSession(id),
      selected: () => selectedSessionId,
    };
  </script>`);
 }
}]});
await server.listen();const browser=await chromium.launch({headless:true});
try{
 for(const theme of ['light','dark']){
  const page=await browser.newPage({viewport:{width:1280,height:800}});const errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
  await page.addInitScript(()=>{
   let callback=0;window.modelReads=0;window.startupCalls=[];
   const model={reference:'model-a',id:'model-a',label:'Cached Model',provider:null,description:null,isDefault:true,defaultReasoningEffort:null,reasoningEfforts:[{id:'high',label:'High',description:null}],serviceTiers:[],contextWindows:[]};
   const catalog={current:model,models:[model],currentReasoningEffort:'high',reasoningEfforts:model.reasoningEfforts,currentServiceTier:null,currentContextWindow:null};
   const session={id:'existing',workspaceId:'w',label:'Existing conversation',agent:'external.agent',state:'idle',archived:false,externalSessionId:'native',pluginInstallationId:'provider',capabilities:['model.select','model.reasoning','turn.send'],createdAt:'2026-09-25',updatedAt:'2026-09-25'};
   const sessions=[session];
   const workspace={id:'w',label:'Startup workspace',path:'/probe',trust:'trusted',createdAt:'2026-09-25',updatedAt:'2026-09-25',lastOpenedAt:null};
   if(!localStorage.getItem('aibo.session-models.v1'))localStorage.setItem('aibo.session-models.v1',JSON.stringify([['existing',{savedAt:Date.now(),catalog}]]));
   const profile={schema:'aibo.execution-profile/v1',interactionMode:'ask',approvalPolicy:'never',approvalReviewer:'none',filesystemPolicy:'read-only',commandPolicy:'disabled',networkPolicy:'agent-managed',model:null,reasoningEffort:null};
   window.releaseModels=()=>{};window.releaseStartup=()=>{};
   window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback(fn){const id=++callback;window['_'+id]=fn;return id},unregisterCallback(id){delete window['_'+id]},async invoke(command,args={}){
    window.startupCalls.push({command,args});
    if(command==='plugin:event|listen')return 1;
    if(command==='read_workspace_preferences')return {trustNewWorkspaces:true};
    if(command==='get_app_snapshot')return {platform:'macos',appVersion:'probe',workspaceCount:1,diagnostics:[]};
    if(command==='list_workspaces')return [workspace];
    if(command==='list_sessions')return sessions.map(s=>({...s}));
    if(command==='get_session_execution_profile')return {sessionId:args.sessionId,requested:profile,enforced:profile,unsupported:[],adapterCapabilities:[],nativeSandbox:false,resolvedAt:'now',sessionControls:[{id:'ask',kind:'mode',label:'Ask',description:'Read only',profile:{interactionMode:'ask'}}]};
    if(command==='get_session_models'){window.modelReads++;return new Promise(resolve=>window.releaseModels=()=>resolve(catalog));}
    if(command==='create_agent_session'){
     if(args.deferStart!==true)throw Error('UI did not defer native startup');
     const pending={...session,id:'new',label:'New conversation',state:'starting',capabilities:[],externalSessionId:null};sessions.push(pending);return {...pending};
    }
    if(command==='resume_agent_session')return new Promise(resolve=>window.releaseStartup=()=>{const s=sessions.find(s=>s.id===args.sessionId);Object.assign(s,{state:'idle',capabilities:session.capabilities,externalSessionId:'new-native'});resolve({...s})});
    if(command==='get_composer_draft')return null;
    if(command==='save_composer_draft')return {text:args.text,sendFailed:false,updatedAt:'now'};
    if(command==='get_session_queue')return {sessionId:args.sessionId,revision:0,steering:[],followUp:[],waiting:[]};
    if(command==='get_turn_change_set')return null;
    if(command==='get_workspace_changes')return {workspaceId:'w',files:[],dirty:false,captureStatus:'captured'};
    if(command==='inspect_workspace_capabilities')return {workspaceId:'w',instructions:[],skills:[],tools:[],mcpServers:[],warnings:[]};
    if(command==='get_presentation_selection')return null;
    return [];
   }};
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  await page.waitForFunction(()=>window.startupActions && document.querySelector('[data-composer-input]'),null,{timeout:30000}).catch(error=>{console.log(JSON.stringify({errors}));throw error});
  const workspaceButton=page.getByRole('button',{name:'Startup workspace，可信',exact:true});
  await workspaceButton.waitFor();
  if(await workspaceButton.getAttribute('aria-expanded')!=='true')await workspaceButton.click();
  await page.getByText('Existing conversation',{exact:true}).first().click();
  await page.evaluate(async theme=>(await import('/src/lib/ui-kit/registry.ts')).setUiTheme(theme),theme);
  const modelButton=page.getByRole('button',{name:'Cached Model · high',exact:true});
  await modelButton.click();
  await page.getByText('正在更新模型配置，以下为上次确认的信息…',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Cached Model，High',exact:true}).isDisabled(),true);
  await page.getByRole('button',{name:'Ask',exact:true}).waitFor();
  await page.evaluate(()=>window.releaseModels());
  await page.waitForFunction(()=>!document.body.innerText.includes('正在更新模型配置'));
  await page.reload();
  await page.waitForFunction(()=>window.startupActions && document.querySelector('[data-composer-input]'),null,{timeout:30000}).catch(error=>{console.log(JSON.stringify({errors}));throw error});
  await page.getByText('Existing conversation',{exact:true}).first().waitFor();
  await page.evaluate(()=>window.startupActions.select('existing'));
  await modelButton.waitFor().catch(async error => { console.log(JSON.stringify(await page.evaluate(()=>({selected:window.startupActions.selected(),cache:localStorage.getItem('aibo.session-models.v1'),body:document.body.innerText,calls:window.startupCalls})),null,2)); throw error; });
  await page.evaluate(()=>{void window.startupActions.create()});
  await page.waitForFunction(()=>window.startupActions.selected()==='new');
  const input=page.locator('[data-composer-input]');await input.fill('Draft while starting');
  assert.equal(await page.getByRole('button',{name:'发送',exact:true}).isDisabled(),true);
  await page.getByRole('button',{name:'Ask',exact:true}).waitFor();
  await page.evaluate(()=>window.startupActions.select('existing'));
  await page.evaluate(()=>window.releaseStartup());
  await page.waitForFunction(()=>window.startupCalls.some(call=>call.command==='save_composer_draft'&&call.args.text==='Draft while starting'));
  assert.equal(await page.evaluate(()=>window.startupActions.selected()),'existing');
  assert.deepEqual(errors,[]);console.log(`${theme}: persisted model label, cached menu, immediate mode menu, pending creation editor, send gate and navigation passed`);
  await page.close();
 }
}finally{await browser.close();await server.close()}
