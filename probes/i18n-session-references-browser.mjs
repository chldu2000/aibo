import assert from 'node:assert/strict';
import {translateMessage} from '../packages/i18n/index.js';
import {readFileSync} from 'node:fs';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {buildPresentationSkins} from './lib/build-presentation-skins.mjs';
const catalogs=Object.fromEntries(['en','zh-CN'].map(locale=>[locale,JSON.parse(readFileSync(new URL(`../packages/i18n/locales/${locale}.json`,import.meta.url),'utf8'))]));
const skins=await buildPresentationSkins();
const server=await createServer({server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false,watch:null},plugins:[{name:'history-i18n-fixture',enforce:'pre',transform(code,id){
 if(!id.endsWith('/src/App.svelte'))return;
 return code.replace('  const sessionHistoryController =',`  if(typeof window!=='undefined')Object.assign(window,{clearRuntimeSessionFixture(){clearSelectedSessionContext();},showOpenLocationFixture(key){window.openLocationKey=key;return openWorkspaceLocation('w');},openHistoryFixture(messageId=null){sessionHistoryRequest={workspaceId:'w',sessionId:'target',messageId};sessionHistoryOpen=true;},inspectHistoryFixture(){return sessionHistory;}});
  const sessionHistoryController =`);
}}]});await server.listen();
const browser=await chromium.launch({headless:true});
try {
 const cases=['material3','ak-ui'].flatMap(kit=>['light','dark'].map(theme=>({kit,theme,pkg:null})));
 for(const pkg of skins.packages)cases.push({kit:'material3',theme:'light',pkg});
 for(const config of cases.filter(config=>!process.env.AIBO_PROBE_EXTERNAL_ONLY||config.pkg)){
  const page=await browser.newPage({viewport:{width:1280,height:900}});page.setDefaultTimeout(15000);
  const errors=[];page.on('pageerror',error=>errors.push(error.stack??error.message));
  await page.addInitScript(({kit,theme,pkg})=>{
   if(window!==window.top)return;
   localStorage.setItem('aibo.language.v1','zh-CN');localStorage.setItem('aibo.appearance.v1',JSON.stringify({kitId:kit,themeId:theme}));
   const sessions=['target','source'].map(id=>({id,workspaceId:'w',label:id==='target'?'Current session':'原始引用 {label}',agent:'unknown.agent',state:'idle',archived:false,externalSessionId:null,pluginInstallationId:'fixture',capabilities:[],createdAt:'now',updatedAt:'now'}));
   const sentLabel='已发送 /用户/{label}/完整会话';
   const sent={schema:'aibo.context-attachment/v1',id:'sent',workspaceId:'w',sessionId:'target',turnId:'t',path:'会话：'+sentLabel,mediaType:'application/vnd.aibo.session-reference+json',sendStrategy:'inline',contentHash:'sha256:sent',size:123,createdAt:'now',inlineContext:JSON.stringify({schema:'aibo.session-reference/v3',snapshotId:'sent',sourceSessionId:'source',sourceLabel:sentLabel,messages:[{role:'assistant',content:'已发送快照原文 {label}'}]})};
   const file={...sent,id:'file',turnId:null,path:'会话：中文原文.txt',mediaType:'text/plain',sendStrategy:'reference',inlineContext:null};
   const attachments=[sent,file];window.referenceAttachments=attachments;let callback=0,messageLimit=12;window.referenceCalls=[];
   const hostError=key=>({code:'invalid_workspace_path',message:'invalid workspace path: 原始诊断',localized:{schema:'aibo.host-message/v1',key,params:{}}});
   const label='模式原文 {label}';
   const system=[
    ['native.session.controlChanged',{label},`审批后切换到 ${label}`],
    ['native.session.controlResetChanged',{label},`审批后清空上下文并切换到 ${label}`],
    ['native.session.contextResetResumed',{},'会话已恢复。之前批准计划时清空过上下文，恢复后 Agent 的上下文可能不包含清空之后的对话与操作；时间线保留了完整记录。'],
   ].map(([key,params,content],index)=>({id:'history-system-'+index,sessionId:'target',role:'system',content,localizedContent:{schema:'aibo.host-message/v1',key,params},status:'completed',createdAt:'2026-10-09',updatedAt:'2026-10-09'}));
   const raw=['user','assistant','tool'].map(role=>({...system[0],id:'history-'+role,role,content:'用户与 Agent 原文 {label}'}));
   raw.push({...system[0],id:'history-legacy',localizedContent:undefined});
   raw.push({...system[0],id:'history-unknown',content:'旧系统原文 {label}',localizedContent:{schema:'aibo.host-message/v1',key:'native.history.unknown',params:{}}});
   for(const status of ['streaming','completed','failed','queued','interrupted','provider-status','constructor'])raw.push({...raw[0],id:'history-status-'+status,status});
   const goalPrompt={...system[0],id:'history-goal-owned',role:'user',toolName:null,turnId:'goal-turn',content:'继续执行当前目标',localizedContent:{schema:'aibo.host-message/v1',key:'native.goal.resumePrompt',params:{}}};
   raw.push(goalPrompt,{...goalPrompt,id:'history-goal-user',localizedContent:undefined},{...goalPrompt,id:'history-goal-assistant',role:'assistant'});
   window.historyFixture={schema:'aibo.session-history-page/v1',source:'persisted-core',session:sessions[0],items:[...system,...raw],nextBefore:null};
   const inventoryCases=[
    ['native.inventory.skillRead',{path:'.codex/技能 {path}',error:'底层原文 {error}'}],
    ['native.inventory.mcpRead',{path:'目录/.mcp.json',error:'底层原文 {error}'}],
    ['native.inventory.mcpJson',{path:'目录/.mcp.json',error:'parser: raw {error}'}],
    ['native.inventory.mcpServers',{path:'目录/.mcp.json'}],
   ];
   window.inventoryFixture={workspaceId:'w',inspectedAt:'unchanged',instructions:[{name:'AGENTS.md',source:'workspace'}],skills:[{name:'技能原文 {id}',source:'.codex/skills'}],tools:[],mcpServers:[{name:'服务器原文 {id}',source:'.mcp.json'}],warnings:inventoryCases.map((_,index)=>'能力原始诊断 '+index).concat('第三方能力警告 {error}'),localizedWarnings:inventoryCases.map(([key,params])=>({schema:'aibo.host-message/v1',key,params})).concat(null)};
   const diagnosticCases=[
    ['native.diagnostics.executableMissing',{label:'程序原文 {label}'}],
    ['native.diagnostics.authStore',{}],
    ['native.diagnostics.probeExit',{label:'程序原文 {label}',status:'exit status: 7'}],
    ['native.diagnostics.probeRun',{label:'程序原文 {label}',error:'底层原文 {error}'}],
    ...['piReady','piReadyOptional','piNodeRequired','webPreview','piPreview'].map(key=>['native.diagnostics.'+key,{}]),
    ['native.diagnostics.unknown',{}],
   ];
   window.diagnosticsFixture=diagnosticCases.map(([key,params],index)=>({agent:'third.party:'+index,label:'诊断程序原文 '+index,status:index%3===0?'missing':index%3===1?'ready':'error',authState:index%3===0?'delegated':index%3===1?'not_required':'unknown',version:index===8?'detected at runtime':null,executable:'/用户/{path}',capabilities:['capability.raw'],message:'原始运行诊断 '+index,localizedMessage:{schema:'aibo.host-message/v1',key,params},...(index===8?{localizedVersion:{schema:'aibo.host-message/v1',key:'native.diagnostics.previewRuntimeVersion',params:{}}}:{})}));
   window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback(fn){const id=++callback;window['_'+id]=fn;return id},unregisterCallback(id){delete window['_'+id]},async invoke(command,args={}){
    window.referenceCalls.push({command,args});
    if(command.startsWith('plugin:event|'))return 1;
    if(command==='get_app_snapshot')return {platform:'macos',appVersion:'probe',workspaceCount:1,diagnostics:window.diagnosticsFixture};
    if(command==='list_workspaces')return [{id:'w',path:'/probe',label:'Workspace',trust:'trusted',createdAt:'now',updatedAt:'now'}];
    if(command==='list_sessions')return sessions;
    if(command==='probe_agents')return window.diagnosticsFixture;
    if(command==='open_workspace_location')throw {code:'initialization_error',message:'app initialization failed: 原始打开诊断',localized:{schema:'aibo.host-message/v1',key:window.openLocationKey,params:{target:args.target,error:'底层原文 {error}'}}};
    if(command==='read_session_history'||command==='read_session_history_around'){
     if(window.historyKey){const key=window.historyKey;throw {code:key.endsWith('Workspace')||key.endsWith('Removed')?'session_operation_error':'invalid_workspace_path',message:'原始历史诊断 {key}',localized:{schema:'aibo.host-message/v1',key,params:{}}};}
     return window.historyFixture;
    }

    if(command==='get_presentation_selection')return pkg?{digest:pkg.release.digest,themeId:pkg.release.manifest.themes[0].id}:null;
    if(command==='list_presentation_packages')return pkg?[pkg.release]:[];
    if(command==='read_presentation_package')return pkg;
    if(command==='list_session_attachments')return attachments;
    if(command==='remove_session_attachment'){const index=attachments.findIndex(item=>item.id===args.attachmentId);if(index>=0)attachments.splice(index,1);return null;}
    if(command==='get_timeline')return [{id:'sent-message',sessionId:'target',turnId:'t',externalMessageId:'sent-message',role:'user',content:'历史正文原文 {label}\n[AIBO_CONTEXT_ATTACHMENTS]\n- '+sent.path+' [attachment:sent]\n[/AIBO_CONTEXT_ATTACHMENTS]',status:'completed',createdAt:'2026-10-09',updatedAt:'2026-10-09'}];

    if(command==='get_composer_draft'||command==='get_turn_change_set'||command==='get_session_execution_profile')return null;
    if(command==='save_composer_draft')return {text:args.text,sendFailed:args.sendFailed,updatedAt:'now'};
    if(command==='get_workspace_changes')return {workspaceId:'w',head:null,branch:null,dirty:false,capturedAt:'now',files:[],captureStatus:'captured',captureError:null};
    if(command==='list_workspace_git_repositories')return {repositories:[],limited:false,warnings:[],scanBudget:2000};
    if(command==='get_workspace_git_remote_status')return {branch:null,upstream:null,ahead:0,behind:0};
    if(command==='inspect_workspace_capabilities')return window.inventoryFixture;
    if(command==='read_workspace_preferences')return {trustNewWorkspaces:true};
    if(command==='read_host_confirmation_preferences')return {git:'always-allow',projectAction:'always-allow',turnRestore:'always-allow',capabilityWrite:'always-allow',viewWrite:'always-allow'};
    if(command==='read_session_reference_preferences')return {messageLimit};
    if(command==='save_session_reference_preferences'){if(window.preferenceError)throw hostError('native.reference.messageLimitInvalid');messageLimit=args.messageLimit;return {messageLimit};}
    if(command==='reference_session'){
     if(window.referenceKey)throw hostError(window.referenceKey);
     const attachment={schema:'aibo.context-attachment/v1',id:'snapshot',workspaceId:'w',sessionId:args.sessionId,turnId:null,path:'会话：原始引用 {label}',contentHash:'sha256:fixture',size:100,mediaType:'application/vnd.aibo.session-reference+json',source:'manual',sendStrategy:'inline',createdAt:'now',inlineContext:JSON.stringify({schema:'aibo.session-reference/v3',snapshotId:'snapshot',sourceSessionId:args.sourceSessionId,sourceLabel:'原始引用 {label}',messages:[{id:'m',role:'assistant',content:'原文 {content}',status:'completed'}]})};
     attachments.push(attachment);return attachment;
    }
    return [];
   }};
  },config);
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
  let scope=page;
  if(config.pkg){await page.locator('.presentation-external iframe').first().waitFor();scope=page.frameLocator('.presentation-external iframe').first();}
  await scope.getByText('Current session',{exact:true}).click();
  const input=scope.locator('textarea');await input.waitFor();
  const setLocale=locale=>page.evaluate(async locale=>{const {language}=await import('/src/lib/i18n/runtime.ts');language.set({preference:locale,locale});},locale);
  const count=command=>page.evaluate(command=>window.referenceCalls.filter(call=>call.command===command).length,command);
  const historyKeys=['workspace','cursor','sequence','messageWorkspace','messageRemoved'].map(key=>'native.history.'+key);
  const fixture=await page.evaluate(()=>window.historyFixture);
  for(const key of [...historyKeys,'native.history.unknown']){
   await page.evaluate(key=>{window.historyKey=key;window.openHistoryFixture(key.endsWith('Workspace')||key.endsWith('Removed')?'missing':null);},key);
   const panel=page.locator('[data-ui-component="session-history"]');
   const zh=catalogs['zh-CN'][key]??'原始历史诊断 {key}',en=catalogs.en[key]??'原始历史诊断 {key}';
   await panel.getByRole('alert').filter({hasText:zh}).waitFor();
   const history=await page.evaluate(()=>window.inspectHistoryFixture());
   const reads=await count('read_session_history')+await count('read_session_history_around');
   await setLocale('en');await panel.getByRole('alert').filter({hasText:en}).waitFor();
   assert.equal(await count('read_session_history')+await count('read_session_history_around'),reads);
   assert.deepEqual(await page.evaluate(()=>window.inspectHistoryFixture()),history);
   await setLocale('zh-CN');await panel.getByRole('alert').filter({hasText:zh}).waitFor();
   await panel.getByRole('button',{name:catalogs['zh-CN']['history.backToWorkbench'],exact:true}).click();
  }
  await page.evaluate(()=>{window.historyKey=null;window.openHistoryFixture();});
  const panel=page.locator('[data-ui-component="session-history"]');await panel.locator('#history-message-history-system-0 textarea').waitFor();
  const canonical=await page.evaluate(()=>window.inspectHistoryFixture());
  const reads=await count('read_session_history')+await count('read_session_history_around');
  for(const locale of ['zh-CN','en','zh-CN']){
   await setLocale(locale);
   const expected=locale==='en'?[
    'Switched to 模式原文 {label} after approval',
    'Cleared the context and switched to 模式原文 {label} after approval',
    catalogs.en['native.session.contextResetResumed'],
   ]:fixture.items.slice(0,3).map(item=>item.content);
   for(let index=0;index<3;index++)await page.waitForFunction(({index,text})=>document.querySelector('#history-message-history-system-'+index+' textarea')?.value===text,{index,text:expected[index]});
   for(const item of fixture.items.slice(3)){
    const text=item.id==='history-goal-owned'?translateMessage(locale,{key:'native.goal.resumePrompt',params:{}}):item.content;
    assert.equal(await panel.locator('#history-message-'+item.id+' textarea').inputValue(),text);
   }
   for(const status of ['streaming','completed','failed','queued','interrupted','provider-status','constructor'])await panel.locator('#history-message-history-status-'+status).getByText(catalogs[locale]['history.status.'+status]??status,{exact:true}).waitFor();
   assert.deepEqual(await page.evaluate(()=>window.inspectHistoryFixture()),canonical);
   assert.equal(await count('read_session_history')+await count('read_session_history_around'),reads);
   assert.deepEqual(await page.evaluate(()=>window.historyFixture),fixture);
  }
  assert.equal(await panel.getByRole('alert').count(),0,'successful history retry clears previous errors');
  await panel.getByRole('button',{name:catalogs['zh-CN']['history.backToWorkbench'],exact:true}).click();
  await input.waitFor();
  for(const key of ['scopeInvalid','empty','selectedTooLarge','snapshotTooLarge'].map(key=>'native.reference.'+key)){
   await page.evaluate(key=>window.referenceKey=key,key);
   const draft='原始草稿 {snapshot} @原始';await input.fill(draft);
   await scope.getByRole('option').filter({hasText:'原始引用 {label}'}).click();
   await page.getByText(catalogs['zh-CN'][key],{exact:true}).waitFor().catch(async error=>{console.error(JSON.stringify({config:{kit:config.kit,theme:config.theme,id:config.pkg?.release.manifest.id},key,calls:await page.evaluate(()=>window.referenceCalls.slice(-20)),text:await page.locator('body').innerText(),errors}));await page.screenshot({path:'/tmp/aibo-i18n-history-failure-109.png'});throw error;});
   const calls=await count('reference_session');
   const request=await page.evaluate(()=>window.referenceCalls.filter(call=>call.command==='reference_session').at(-1).args);
   assert.deepEqual(request,{sessionId:'target',sourceSessionId:'source'});
   await setLocale('en');await page.getByText(catalogs.en[key],{exact:true}).waitFor();
   assert.equal(await input.inputValue(),draft);assert.equal(await count('reference_session'),calls);
   await scope.getByText('原始引用 {label}',{exact:true}).first().waitFor();
   await setLocale('zh-CN');await page.getByText(catalogs['zh-CN'][key],{exact:true}).waitFor();
   assert.equal(await input.inputValue(),draft);assert.equal(await count('reference_session'),calls);
  }
  await page.evaluate(()=>window.referenceKey='');await input.fill('成功草稿 @原始');
  await scope.getByRole('option').filter({hasText:'原始引用 {label}'}).click();
  await page.getByText(catalogs['zh-CN']['app.referenceAdded'],{exact:true}).waitFor();
  assert.equal(await input.inputValue(),'成功草稿 ');
  assert.equal(await page.getByText(catalogs['zh-CN']['native.reference.snapshotTooLarge'],{exact:true}).count(),0);
  const originalAttachments=await page.evaluate(()=>window.referenceAttachments);
  const attachmentReads=await count('list_session_attachments'),captures=await count('reference_session');
  for(const locale of ['zh-CN','en','zh-CN']){
   await setLocale(locale);
   const prefix=locale==='en'?'Session: ':'会话：';
   await scope.getByText(prefix+'原始引用 {label}',{exact:true}).first().waitFor();
   await scope.getByText(prefix+'已发送 /用户/{label}/完整会话',{exact:true}).first().waitFor();
   await scope.getByText('会话：中文原文.txt',{exact:true}).first().waitFor();
   await scope.getByText('历史正文原文 {label}',{exact:true}).waitFor();
   assert.deepEqual(await page.evaluate(()=>window.referenceAttachments),originalAttachments);
   assert.equal(await count('list_session_attachments'),attachmentReads);assert.equal(await count('reference_session'),captures);
  }
  await scope.getByRole(config.pkg?'button':'tab',{name:'上下文',exact:true}).click();
  for(const locale of ['zh-CN','en','zh-CN']){
   await setLocale(locale);const prefix=locale==='en'?'Session: ':'会话：';
   await scope.getByText(prefix+'已发送 /用户/{label}/完整会话',{exact:true}).first().waitFor();
   await scope.getByText(prefix+'原始引用 {label}',{exact:true}).first().waitFor();
   assert.deepEqual(await page.evaluate(()=>window.referenceAttachments),originalAttachments);
   assert.equal(await count('list_session_attachments'),attachmentReads);
  }
  const inventory=await page.evaluate(()=>window.inventoryFixture);const scans=await count('inspect_workspace_capabilities');
  for(const locale of ['zh-CN','en','zh-CN']){
   await setLocale(locale);
   await scope.getByRole(config.pkg?'heading':'region',{name:catalogs[locale]['composer.category.skill'],exact:true}).waitFor();
   for(const [index,metadata] of inventory.localizedWarnings.entries()){
    const expected=metadata?catalogs[locale][metadata.key].replace(/\{(\w+)\}/g,(_,key)=>metadata.params[key]):inventory.warnings[index];
    await scope.getByText(expected,{exact:Boolean(config.pkg)}).first().waitFor();
   }
   await scope.getByText(config.pkg?'技能原文 {id} · .codex/skills':'技能原文 {id}',{exact:true}).waitFor();await scope.getByText(config.pkg?'服务器原文 {id} · .mcp.json':'服务器原文 {id}',{exact:true}).waitFor();
   assert.deepEqual(await page.evaluate(()=>window.inventoryFixture),inventory);assert.equal(await count('inspect_workspace_capabilities'),scans);
  }
  const remove=scope.getByRole('button',{name:'移除附件 会话：原始引用 {label}',exact:true});
  await remove.click();await page.waitForFunction(()=>window.referenceCalls.some(call=>call.command==='remove_session_attachment'));
  assert.deepEqual(await page.evaluate(()=>window.referenceCalls.filter(call=>call.command==='remove_session_attachment').at(-1).args),{sessionId:'target',attachmentId:'snapshot'});
  await page.evaluate(()=>window.clearRuntimeSessionFixture());
  const diagnostic=await page.evaluate(()=>window.diagnosticsFixture);const probes=await count('probe_agents'),snapshots=await count('get_app_snapshot');
  for(const locale of ['zh-CN','en','zh-CN']){
   await setLocale(locale);
   for(const item of diagnostic){
    const metadata=item.localizedMessage;const expected=catalogs[locale][metadata.key]?.replace(/\{(\w+)\}/g,(_,key)=>metadata.params[key])??item.message;
    await scope.getByText(expected,{exact:true}).first().waitFor();
    await scope.getByText(item.label,{exact:true}).waitFor();
   }
   await scope.getByText(catalogs[locale]['native.diagnostics.previewRuntimeVersion'],{exact:true}).waitFor();
   assert.deepEqual(await page.evaluate(()=>window.diagnosticsFixture),diagnostic);assert.equal(await count('probe_agents'),probes);assert.equal(await count('get_app_snapshot'),snapshots);
  }
  for(const key of ['openLocation','editorMac','editorWindows','editorUnix','locationTarget'].map(key=>'native.workspace.'+key)){
   await page.evaluate(key=>window.showOpenLocationFixture(key),key);
   const params={target:'finder',error:'底层原文 {error}'};
   const expected=locale=>catalogs[locale][key].replace(/\{(\w+)\}/g,(_,name)=>params[name]);
   await page.getByText(expected('zh-CN'),{exact:true}).waitFor();const opens=await count('open_workspace_location');
   await setLocale('en');await page.getByText(expected('en'),{exact:true}).waitFor();assert.equal(await count('open_workspace_location'),opens);
   await setLocale('zh-CN');await page.getByText(expected('zh-CN'),{exact:true}).waitFor();
   assert.deepEqual(await page.evaluate(()=>window.referenceCalls.filter(call=>call.command==='open_workspace_location').at(-1).args),{workspaceId:'w',target:'finder'});
  }

  await page.locator('[data-host-navigation="management"]').click();
  const dialog=page.getByRole('dialog');await dialog.getByRole('tab',{name:'运行与诊断',exact:true}).click();
  for(const locale of ['zh-CN','en','zh-CN']){
   await setLocale(locale);
   for(const key of ['inspector.available','inspector.notInstalled','inspector.error','diagnostics.authNotRequired','diagnostics.authUnknown','inspector.noVersion'])await dialog.getByText(catalogs[locale][key],{exact:true}).first().waitFor();
   for(const item of diagnostic)await dialog.getByText(item.label,{exact:true}).waitFor();
   assert.equal(await count('probe_agents'),probes);assert.equal(await count('get_app_snapshot'),snapshots);
  }
  await dialog.getByRole('tab',{name:'工作区',exact:true}).click();
  const field=dialog.getByRole('spinbutton',{name:catalogs['zh-CN']['references.maximum'],exact:true});await field.fill('23');
  await page.evaluate(()=>window.preferenceError=true);await dialog.getByRole('button',{name:catalogs['zh-CN']['references.saveCount'],exact:true}).click();
  const key='native.reference.messageLimitInvalid';await dialog.getByRole('alert').filter({hasText:catalogs['zh-CN'][key]}).waitFor();
  const saves=await count('save_session_reference_preferences');await setLocale('en');await dialog.getByRole('alert').filter({hasText:catalogs.en[key]}).waitFor();
  assert.equal(await dialog.getByRole('spinbutton',{name:'Maximum messages',exact:true}).inputValue(),'23');assert.equal(await count('save_session_reference_preferences'),saves);
  await setLocale('zh-CN');await dialog.getByRole('alert').filter({hasText:catalogs['zh-CN'][key]}).waitFor();
  await dialog.getByRole('button',{name:catalogs['zh-CN']['references.reload'],exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('[aria-labelledby="session-reference-preferences-title"] [role="alert"]'));
  assert.equal(await field.inputValue(),'12','explicit reload restores the saved count');
  await field.fill('23');await page.evaluate(()=>window.preferenceError=false);await dialog.getByRole('button',{name:catalogs['zh-CN']['references.saveCount'],exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('[aria-labelledby="session-reference-preferences-title"] [role="alert"]'));
  assert.equal(await field.inputValue(),'23');assert.deepEqual(errors,[]);
  console.log(`${config.kit}/${config.theme}/${config.pkg?.release.manifest.id??'builtin'}: runtime diagnostics, inventory warnings and reference names translate without probes, scans or identity changes; history errors and host notices translate without reads or body changes; reference validation translates, preserves drafts and retries without duplicate captures or saves`);
  await page.close();
 }
}finally{await browser.close();await server.close();await skins.dispose();}
