import assert from 'node:assert/strict';
import {translateMessage} from '../packages/i18n/index.js';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {buildPresentationSkins} from './lib/build-presentation-skins.mjs';
const skins=await buildPresentationSkins();
const server=await createServer({server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false,watch:null},plugins:[{
 name:'turn-i18n-fixture',enforce:'pre',transform(code,id){
  if(!id.endsWith('/src/App.svelte'))return;
  return code.replace('  const turnFileDiff =', `
  if(typeof window !== 'undefined') Object.assign(window,{showCrashScenario(payload,type='adapter.crashed'){handleAgentEvent({schemaVersion:'2.0',eventId:'host-failure',generationId:'generation',sequence:99,occurredAt:'2026-10-09',workspaceId:'workspace',sessionId:'session',nativeSessionId:'native',turnId:'turn',type,source:{},correlation:null,payload,rawRef:null})},inspectCrashScenario(){return {retryPrompt,retryReason}},showTurnScenario(){return turnChanges.showDiff('session','turn','原文{path}.txt')},showQueueScenario(key,params={}){queueSnapshot=normalizeMessageQueue({items:[{id:'queue-item',text:'队列正文原文 {error}',status:'uncertain',error:'队列原始诊断',...(key?{localizedError:{schema:'aibo.host-message/v1',key,params}}:{})}],paused:true,revision:77},'session')},showQueueActionScenario(key){window.queueActionKey=key;queueSnapshot=normalizeMessageQueue({items:[{id:'queue-item',text:'队列正文原文 {error}',status:'failed',error:null}],paused:true,revision:78},'session')},inspectQueueScenario(){return queueSnapshot},showRecoveryScenario(key,params={}){turnChangeSet={...window.turnFixture,captureStatus:'partial',captureError:'恢复原始诊断',...(key?{localizedCaptureError:{schema:'aibo.host-message/v1',key,params}}:{})}},inspectRecoveryScenario(){return turnChangeSet},showCheckpointScenario(key){checkpoints=[{schema:'aibo.checkpoint/v1',id:'checkpoint',workspaceId:'workspace',sessionId:'session',turnId:'turn',path:'原文{reason}.txt',fileExists:true,contentHash:'raw-hash',size:7,storagePath:null,baselineDirty:false,available:false,reason:'checkpoint 原始诊断',createdAt:'now',...(key?{localizedReason:{schema:'aibo.host-message/v1',key,params:{}}}:{})}]},inspectCheckpointScenario(){return checkpoints},inspectTurnScenario(){return {diff:turnChange.diff,changeSet:turnChangeSet,inspector:externalInspector,revision:externalInput.context.revision}}});
  const turnFileDiff =`);
 }
}]});await server.listen();
const browser=await chromium.launch({headless:true});
try{
 const cases=['material3','ak-ui'].flatMap(kit=>['light','dark'].map(theme=>({kit,theme,pkg:null})));
 for(const pkg of skins.packages)cases.push({kit:'material3',theme:'light',pkg});
 for(const config of cases.filter(config=>!process.env.AIBO_PROBE_EXTERNAL_ONLY||config.pkg)){
  const page=await browser.newPage({viewport:{width:1280,height:900}});page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(({kit,theme,pkg})=>{
   if(window!==window.top)return;
   localStorage.setItem('aibo.language.v1','zh-CN');localStorage.setItem('aibo.selected-session',JSON.stringify({workspaceId:'workspace',sessionId:'session'}));localStorage.setItem('aibo.appearance.v1',JSON.stringify({kitId:kit,themeId:theme}));
   let callback=0;window.diffCalls=[];
   window.turnFixture={id:'set',schema:'aibo.turn-changeset/v1',workspaceId:'workspace',sessionId:'session',turnId:'turn',baseline:{head:null,dirty:false,capturedAt:'now'},result:{head:null,dirty:true,capturedAt:'now'},files:[{path:'原文{path}.txt',previousPath:null,kind:'modified',baselineExists:true,baselineHash:'before',baselineSize:1,baselineDirty:false,resultExists:true,resultHash:'after',resultSize:2}],commands:[],verification:[],attribution:'agent',captureStatus:'captured',captureError:null};
   const display={schema:'aibo.host-message/v1',key:'native.restore.unsafeBaseline',params:{path:'原文{path}.txt'}};
   window.restoreFixture={schema:'aibo.restore-operation/v1',id:'restore',workspaceId:'workspace',sessionId:'session',turnId:'turn',status:'blocked',restored:[],conflicts:[],unsupported:['原始诊断'],localizedConflicts:[],localizedUnsupported:[display],createdAt:'now'};
   window.auditFixture={id:'audit',sessionId:'session',turnId:'turn',externalMessageId:'restore:restore',role:'system',toolName:null,entryType:null,content:'恢复审计原始诊断',status:'completed',createdAt:'2026-10-09',updatedAt:'2026-10-09',localizedContent:{schema:'aibo.host-message/v1',key:'native.restore.auditBlocked',params:{conflicts:{key:'native.restore.noItems',params:{}},unsupported:{kind:'list',items:[display]}}}};
   const label='模式原文 {label}';
   window.contextFixtures=[
    ['native.session.controlChanged',{label},`审批后切换到 ${label}`],
    ['native.session.controlResetChanged',{label},`审批后清空上下文并切换到 ${label}`],
    ['native.session.contextResetResumed',{},'会话已恢复。之前批准计划时清空过上下文，恢复后 Agent 的上下文可能不包含清空之后的对话与操作；时间线保留了完整记录。'],
   ].map(([key,params,content],index)=>({...window.auditFixture,id:'context-'+index,externalMessageId:'context-'+index,content,localizedContent:{schema:'aibo.host-message/v1',key,params}}));
   const child={id:'child',parentId:'parent',rootTurnId:'turn',name:'子任务名称 {name}',task:'子任务内容 {task}',activity:'执行已中断，已保留收到的过程记录。',status:'interrupted'};
   window.childFixtures=[{...window.auditFixture,id:'child-card',toolName:'subagent',status:'failed',localizedContent:undefined,content:JSON.stringify(child),localizedActivity:{schema:'aibo.host-message/v1',key:'native.subagent.interruptedActivity',params:{}}},{...window.auditFixture,id:'child-raw',toolName:'subagent',status:'completed',localizedContent:undefined,content:JSON.stringify({...child,id:'child-raw',name:'提供者名称',task:'提供者任务 {task}',activity:'提供者活动 {activity}',status:'completed'})}];
   const background={id:'job',rootTurnId:'turn',name:'后台任务 {name}',command:'echo 命令原文 {command}',activity:'任务属于原会话，分支不继承进程状态。',status:'unknown',exitCode:7,outputPath:'/用户/{path}'};
   window.backgroundFixtures=[{...window.auditFixture,id:'background-card',toolName:'background_task',status:'failed',localizedContent:undefined,content:JSON.stringify(background),localizedActivity:{schema:'aibo.host-message/v1',key:'native.background.forkActivity',params:{}}},{...window.auditFixture,id:'background-legacy',toolName:'background_task',status:'failed',localizedContent:undefined,content:JSON.stringify({...background,id:'legacy',name:'旧任务 {name}'})}];
   const goalPrompt={...window.auditFixture,id:'goal-owned',role:'user',toolName:null,content:'继续执行当前目标',localizedContent:{schema:'aibo.host-message/v1',key:'native.goal.resumePrompt',params:{}}};
   window.goalFixtures=[goalPrompt,{...goalPrompt,id:'goal-user',localizedContent:undefined},{...goalPrompt,id:'goal-assistant',role:'assistant'}];
   window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback(fn){const id=++callback;window['_'+id]=fn;return id},unregisterCallback(id){delete window['_'+id]},async invoke(command,args={}){
    window.diffCalls.push({command,args});
    if(command.startsWith('plugin:event|'))return 1;
    if(command==='get_app_snapshot')return {platform:'macos',appVersion:'probe',workspaceCount:0,diagnostics:[]};
    if(command==='read_workspace_preferences')return {trustNewWorkspaces:true};
    if(command==='get_presentation_selection')return pkg?{digest:pkg.release.digest,themeId:pkg.release.manifest.themes[0].id}:null;
    if(command==='list_presentation_packages')return pkg?[pkg.release]:[];
    if(command==='read_presentation_package')return pkg;
    if(command==='list_workspaces')return [{id:'workspace',path:'/probe',label:'Project',trust:'trusted',createdAt:'now',updatedAt:'now'}];
    if(command==='list_sessions')return [{id:'session',workspaceId:'workspace',agent:'third.party.agent',label:'Session',state:'idle',archived:false,externalSessionId:null,pluginInstallationId:'queue-provider',capabilities:['queue.manage'],createdAt:'now',updatedAt:'now'}];
    if(command==='get_workspace_changes')return {workspaceId:'workspace',head:null,branch:null,dirty:false,files:[],captureStatus:'captured',captureError:null};
    if(command==='list_workspace_git_repositories')return {repositories:[],limited:false,warnings:[]};
    if(command==='inspect_workspace_capabilities')return {workspaceId:'workspace',inspectedAt:'now',instructions:[],skills:[],tools:[],mcpServers:[],warnings:[]};
    if(command==='get_turn_change_set')return window.turnFixture;
    if(command==='list_restore_operations')return [window.restoreFixture];
    if(command==='get_timeline')return [...window.contextFixtures,...window.childFixtures,...window.backgroundFixtures,...window.goalFixtures,window.auditFixture,{...window.auditFixture,id:'raw',role:'assistant',content:'插件原文',localizedContent:undefined}];
    if(command==='get_turn_file_diff'&&window.diffKey==='truncated')return {path:args.path,available:true,diff:'@@ raw\n+原文 {suffix}\n… diff 已截断',hunks:[{index:0,header:'@@ raw',content:'@@ raw\n+原文 {suffix}\n… diff 已截断'}],reason:null,localizedSuffix:{schema:'aibo.host-message/v1',key:'native.diff.truncatedSuffix',params:{}}};
    if(command==='get_turn_file_diff')return {path:args.path,available:false,diff:'',hunks:[],reason:'原始诊断',...(window.diffKey?{localizedReason:{schema:'aibo.host-message/v1',key:window.diffKey,params:{}}}:{})};
    if(command==='get_composer_draft'||command==='save_composer_draft')return null;
    if(command==='get_session_execution_profile')return null;
    if(command==='get_session_models')return null;
    if(command==='invoke_agent_capability'&&args.capability==='queue.manage'){
     if(args.input.action==='get')return {items:[],paused:false,revision:0};
     if(['resume','sendNow'].includes(args.input.action))throw {message:'队列动作原始诊断',localized:{schema:'aibo.host-message/v1',key:window.queueActionKey,params:{}}};
    }
    return [];
   }};
  },config);
  // Allow the first Vite compilation; interaction assertions keep their 15s deadlines.
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`,{timeout:60000});
  await page.waitForFunction(()=>Boolean(window.showTurnScenario));
  let scope=page;
  if(config.pkg){await page.locator('.presentation-external iframe').first().waitFor();scope=page.frameLocator('.presentation-external iframe').first();await page.locator('.presentation-external iframe').first().evaluate(el=>el.dataset.probeIdentity='same');}
  await scope.getByText('插件原文',{exact:true}).waitFor();
  for(const [localizedReason,zh,en] of [
   [{schema:'aibo.host-message/v1',key:'native.session.invocationFailure',params:{code:'cancelled',error:{key:'native.broker.cancelled',params:{}}}},'cancelled：调用已取消。','cancelled: Invocation was cancelled'],
   [{schema:'aibo.host-message/v1',key:'native.session.recoveryGeneration',params:{}},'会话运行实例已变化，此恢复响应不再有效。','The session runtime changed. The recovery response is no longer valid.'],
   [undefined,'回合错误原文 {error}','回合错误原文 {error}'],
   [{schema:'aibo.host-message/v1',key:'native.unknown',params:{}},'回合错误原文 {error}','回合错误原文 {error}'],
   [{schema:'invalid',key:'native.broker.cancelled',params:{}},'回合错误原文 {error}','回合错误原文 {error}'],
  ]){
   await page.evaluate(payload=>window.showCrashScenario(payload),{reason:'回合错误原文 {error}',status:'failed',localizedReason});
   await scope.getByText(zh,{exact:true}).waitFor();
   const original=await page.evaluate(()=>window.inspectCrashScenario());
   await page.waitForTimeout(250);
   // The App polls the plugin/presentation catalogs independently every two seconds.
   const calls=await page.evaluate(()=>window.diffCalls.filter(call=>!['set_window_locale','list_semantic_contributions','list_presentation_packages'].includes(call.command)));
   await page.evaluate(async()=>{const {language}=await import('/src/lib/i18n/runtime.ts');language.set({preference:'en',locale:'en'});});
   await scope.getByText(en,{exact:true}).waitFor();
   assert.deepEqual(await page.evaluate(()=>window.inspectCrashScenario()),original);
   assert.deepEqual(await page.evaluate(()=>window.diffCalls.filter(call=>!['set_window_locale','list_semantic_contributions','list_presentation_packages'].includes(call.command))),calls);
   await page.evaluate(async()=>{const {language}=await import('/src/lib/i18n/runtime.ts');language.set({preference:'zh-CN',locale:'zh-CN'});});
   await scope.getByText(zh,{exact:true}).waitFor();
   assert.deepEqual(await page.evaluate(()=>window.inspectCrashScenario()),original);
   if(config.pkg)assert.equal(await page.locator('.presentation-external iframe').first().getAttribute('data-probe-identity'),'same');
  }
  await page.evaluate(()=>window.showCrashScenario({status:'completed'},'turn.completed'));
  await page.waitForFunction(()=>window.inspectCrashScenario().retryReason===null&&window.inspectCrashScenario().retryPrompt===null);
  await page.waitForTimeout(250);
  const contexts=await page.evaluate(()=>window.contextFixtures);
  const children=await page.evaluate(()=>window.childFixtures);
  const background=await page.evaluate(()=>window.backgroundFixtures);
  const goals=await page.evaluate(()=>window.goalFixtures);
  const timelineReads=await page.evaluate(()=>window.diffCalls.filter(call=>call.command==='get_timeline').length);
  for(const locale of ['zh-CN','en','zh-CN']){
   await page.evaluate(async locale=>{const {language}=await import('/src/lib/i18n/runtime.ts');language.set({preference:locale,locale});},locale);
   const expected=locale==='en'?[
    'Switched to 模式原文 {label} after approval',
    'Cleared the context and switched to 模式原文 {label} after approval',
    'The session has resumed. Its context was cleared when the plan was approved. The restored Agent context may omit conversations and actions after that reset; the timeline retains the complete record.',
   ]:contexts.map(item=>item.content);
   for(const text of expected)await scope.getByText(text,{exact:true}).waitFor();
   await scope.getByText('插件原文',{exact:true}).waitFor();
   await scope.getByText(locale==='en'?'Execution was interrupted. The received process records have been retained.':'执行已中断，已保留收到的过程记录。',{exact:true}).waitFor();
   for(const text of ['子任务名称 {name}','子任务内容 {task}','提供者任务 {task}','提供者活动 {activity}'])await scope.getByText(text,{exact:true}).waitFor();
   assert.deepEqual(await page.evaluate(()=>window.childFixtures),children);
   assert.equal(await scope.getByText(locale==='en'?'This task belongs to the source session. A branch does not inherit its process state.':'任务属于原会话，分支不继承进程状态。',{exact:true}).count(),locale==='en'?1:2);
   assert.equal(await scope.getByText('任务属于原会话，分支不继承进程状态。',{exact:true}).count(),locale==='en'?1:2);
   for(const text of ['echo 命令原文 {command}'])assert.equal(await scope.getByText(text,{exact:true}).count(),2);
   assert.deepEqual(await page.evaluate(()=>window.backgroundFixtures),background);
   await scope.getByText(locale==='en'?'Continue working on the current goal.':'继续执行当前目标',{exact:true}).first().waitFor();
   assert.equal(await scope.getByText('Continue working on the current goal.',{exact:true}).count(),locale==='en'?1:0);
   assert.equal(await scope.getByText('继续执行当前目标',{exact:true}).count(),locale==='en'?2:3);
   assert.deepEqual(await page.evaluate(()=>window.goalFixtures),goals);
   assert.deepEqual(await page.evaluate(()=>window.contextFixtures),contexts);
   assert.equal(await page.evaluate(()=>window.diffCalls.filter(call=>call.command==='get_timeline').length),timelineReads);
   if(config.pkg)assert.equal(await page.locator('.presentation-external iframe').first().getAttribute('data-probe-identity'),'same');
  }

  for(const [key,zh,en,params={}] of [
   ['native.queue.restarted','应用已重启，投递结果未知，请核对会话记录。','The app restarted. Delivery is unknown; check the conversation history.'],
   ['native.queue.unacknowledged','未收到投递确认，请核对会话记录后处理。','No delivery acknowledgement was received. Check the conversation history before taking action.'],
   ['native.image.attachmentChanged','图片附件已变化，请重新粘贴。','The image attachment changed. Paste it again.'],
   ['native.image.unsupportedInput','当前 Agent 不支持图片输入。','The current Agent does not support image input.'],
   ['native.attachment.unavailable','附件不可用：原文{path}.txt: 文件大小已变化','Attachment unavailable: 原文{path}.txt: The file size changed.',{path:'原文{path}.txt',reason:{key:'native.attachment.sizeChanged',params:{}}}],
   ['native.attachment.unavailable','附件不可用：原文{path}.txt: 文件内容已变化','Attachment unavailable: 原文{path}.txt: The file content changed.',{path:'原文{path}.txt',reason:{key:'native.attachment.contentChanged',params:{}}}],
   ['native.attachment.unavailable','附件不可用：原文{path}.txt: 底层诊断 {reason}','Attachment unavailable: 原文{path}.txt: 底层诊断 {reason}',{path:'原文{path}.txt',reason:'底层诊断 {reason}'}],
   [null,'队列原始诊断','队列原始诊断'],
   ['native.queue.unknown','队列原始诊断','队列原始诊断'],
  ]) {
   await page.evaluate(({key,params})=>window.showQueueScenario(key,params),{key,params});
   await scope.getByText(zh,{exact:true}).waitFor();await scope.getByText('队列正文原文 {error}',{exact:true}).waitFor();
   const original=await page.evaluate(()=>window.inspectQueueScenario());
   const reads=await page.evaluate(()=>window.diffCalls.filter(call=>JSON.stringify(call.args).includes('queue.manage')).length);
   await page.evaluate(async()=>{const {language}=await import('/src/lib/i18n/runtime.ts');language.set({preference:'en',locale:'en'});});
   await scope.getByText(en,{exact:true}).waitFor();await scope.getByText('队列正文原文 {error}',{exact:true}).waitFor();
   assert.deepEqual(await page.evaluate(()=>window.inspectQueueScenario()),original);
   assert.equal(await page.evaluate(()=>window.diffCalls.filter(call=>JSON.stringify(call.args).includes('queue.manage')).length),reads);
   if(config.pkg)assert.equal(await page.locator('.presentation-external iframe').first().getAttribute('data-probe-identity'),'same');
   await page.evaluate(async()=>{const {language}=await import('/src/lib/i18n/runtime.ts');language.set({preference:'zh-CN',locale:'zh-CN'});});
   await scope.getByText(zh,{exact:true}).waitFor();
  }

  for(const [action,key,zh,en] of [
   ['resume','native.queue.resumeUncertain','请先核对并移除投递结果未知的消息。','Check and remove messages with unknown delivery results before resuming.'],
   ['sendNow','native.queue.sendUncertain','消息投递结果未知，请核对会话记录后删除该条，避免重复发送。','Delivery is unknown. Check the conversation history and delete this message to avoid sending it twice.'],
   ['sendNow','native.queue.missing','这条排队消息已不存在。','This queued message no longer exists.'],
   ['sendNow','native.queue.sending','这条消息正在发送。','This message is already being sent.'],
   ['sendNow','native.queue.stopping','会话正在停止，请停止后重试。','The session is stopping. Try again after it stops.'],
   ['sendNow','native.queue.finishing','会话仍在结束当前回合，请完成后重试。','The session is still finishing its turn. Try again after it finishes.'],
   ['resume','native.queue.full','队列已满（100 条消息），请移除消息后再添加。','The queue is full (100 messages). Remove a message before adding another.'],
   ['resume','native.queue.actionRequired','请选择队列操作。','Choose a queue action.'],
   ['resume','native.queue.messageRequired','请提供要加入队列的消息。','Provide a message to add to the queue.'],
   ['resume','native.queue.idRequired','请选择队列中的消息。','Choose a queued message.'],
   ['resume','native.queue.unknownAction','不支持此队列操作。','This queue action is not supported.'],
  ]){
   // A stale UI snapshot permits the click; authoritative host admission rejects it.
   await page.evaluate(key=>window.showQueueActionScenario(key),key);
   const original=await page.evaluate(()=>window.inspectQueueScenario());
   await scope.getByRole('button',{name:action==='resume'?'继续队列':'立即发送',exact:true}).click();
   await page.getByText(zh,{exact:true}).waitFor();
   const calls=await page.evaluate(()=>window.diffCalls.filter(call=>call.command==='invoke_agent_capability').length);
   await page.evaluate(async()=>{const {language}=await import('/src/lib/i18n/runtime.ts');language.set({preference:'en',locale:'en'});});
   await page.getByText(en,{exact:true}).waitFor();
   assert.equal(await page.evaluate(()=>window.diffCalls.filter(call=>call.command==='invoke_agent_capability').length),calls);
   assert.deepEqual(await page.evaluate(()=>window.inspectQueueScenario()),original);
   const request=await page.evaluate(()=>window.diffCalls.filter(call=>call.command==='invoke_agent_capability').at(-1).args);
   assert.equal(request.sessionId,'session');assert.equal(request.capability,'queue.manage');assert.equal(request.input.action,action);
   if(action==='sendNow')assert.equal(request.input.id,'queue-item');
   if(config.pkg)assert.equal(await page.locator('.presentation-external iframe').first().getAttribute('data-probe-identity'),'same');
   await page.evaluate(async()=>{const {language}=await import('/src/lib/i18n/runtime.ts');language.set({preference:'zh-CN',locale:'zh-CN'});});
   await page.getByText(zh,{exact:true}).waitFor();
  }

  await scope.getByRole(config.pkg?'button':'tab',{name:'上下文',exact:true}).click();
  await page.waitForFunction(()=>window.inspectTurnScenario().inspector.activeView==='context');
  for(const [key,zh,en,params] of [
   ['native.recovery.noBaseline','应用重启后重建；turn 基线 checkpoint 未持久化','Rebuilt after the app restarted; the turn baseline checkpoint was not persisted.'],
   ['native.recovery.uncertainContent','应用重启后重建；结果可能包含崩溃后的用户修改','Rebuilt after the app restarted; the result may include user changes made after the crash.'],
   ...['native.capture.taskFailed','native.capture.readTracked','native.capture.scan','native.capture.entry','native.capture.gitPath','native.capture.workspacePath','native.changes.canonicalize','native.changes.readHead','native.changes.readStatus','native.changes.statusExited','native.recovery.captureFailed'].map(key=>{
    const params={path:'路径原文 {path}',status:'退出原文 {status}',error:{key:'native.path.outsideWorkspace',params:{}}};
    return [key,translateMessage('zh-CN',{key,params}),translateMessage('en',{key,params}),params];
   }),
   [null,'恢复原始诊断','恢复原始诊断'],
   ['native.recovery.unknown','恢复原始诊断','恢复原始诊断'],
  ]) {
   await page.evaluate(({key,params})=>window.showRecoveryScenario(key,params),{key,params});await scope.getByText(zh,{exact:true}).first().waitFor();
   const original=await page.evaluate(()=>window.inspectRecoveryScenario());
   const reads=await page.evaluate(()=>window.diffCalls.filter(call=>call.command==='get_turn_change_set').length);
   await page.evaluate(async()=>{const {language}=await import('/src/lib/i18n/runtime.ts');language.set({preference:'en',locale:'en'});});
   await scope.getByText(en,{exact:true}).first().waitFor();
   assert.deepEqual(await page.evaluate(()=>window.inspectRecoveryScenario()),original);
   assert.equal(await page.evaluate(()=>window.diffCalls.filter(call=>call.command==='get_turn_change_set').length),reads);
   if(config.pkg)assert.equal(await page.locator('.presentation-external iframe').first().getAttribute('data-probe-identity'),'same');
   await page.evaluate(async()=>{const {language}=await import('/src/lib/i18n/runtime.ts');language.set({preference:'zh-CN',locale:'zh-CN'});});await scope.getByText(zh,{exact:true}).first().waitFor();
  }


  for(const [key,zh,en] of [
   ['native.checkpoint.unavailable','baseline 文件过大、不可哈希或 checkpoint 文件不可用','The baseline file is too large, cannot be hashed, or its checkpoint file is unavailable.'],
   [null,'checkpoint 原始诊断','checkpoint 原始诊断'],
   ['native.checkpoint.unknown','checkpoint 原始诊断','checkpoint 原始诊断'],
  ]) {
   await page.evaluate(key=>window.showCheckpointScenario(key),key);
   async function reason(text){if(config.pkg)await scope.getByText('原文{reason}.txt · '+text,{exact:true}).waitFor();else await page.waitForFunction(text=>document.querySelector('.checkpoint-item-badges')?.title===text,text);}
   await reason(zh);const original=await page.evaluate(()=>window.inspectCheckpointScenario());
   const reads=await page.evaluate(()=>window.diffCalls.filter(call=>call.command==='list_turn_checkpoints').length);
   await page.evaluate(async()=>{const {language}=await import('/src/lib/i18n/runtime.ts');language.set({preference:'en',locale:'en'});});await reason(en);
   assert.deepEqual(await page.evaluate(()=>window.inspectCheckpointScenario()),original);
   assert.equal(await page.evaluate(()=>window.diffCalls.filter(call=>call.command==='list_turn_checkpoints').length),reads);
   if(config.pkg)assert.equal(await page.locator('.presentation-external iframe').first().getAttribute('data-probe-identity'),'same');
   await page.evaluate(async()=>{const {language}=await import('/src/lib/i18n/runtime.ts');language.set({preference:'zh-CN',locale:'zh-CN'});});await reason(zh);
  }
  for(const [key,zh,en] of [
   ['native.turn.binary','二进制文件暂不支持 hunk 操作','Hunk operations are unavailable for binary files.'],
   ['native.turn.checkpointMissing','缺少 baseline checkpoint','The baseline checkpoint is missing.'],
   ['native.turn.laterChanges','当前文件已在本轮后发生变化，拒绝应用 hunk','The file changed after this turn. Applying a hunk is blocked.'],
   [null,'原始诊断','原始诊断'],
   ['native.turn.unknown','原始诊断','原始诊断'],
  ]){
   await page.evaluate(async key=>{window.diffKey=key;await window.showTurnScenario();},key);await scope.getByText(zh,{exact:true}).waitFor().catch(async error=>{console.log(JSON.stringify(await page.evaluate(()=>{const value=window.inspectTurnScenario();return {view:value.inspector.activeView,reason:value.inspector.fileDiff?.reason,revision:value.revision}})));throw error;});
   const reads=await page.evaluate(()=>window.diffCalls.filter(call=>call.command.includes('file_diff')).length);
   await page.evaluate(async()=>{const {language}=await import('/src/lib/i18n/runtime.ts');language.set({preference:'en',locale:'en'});});
   await scope.getByText(en,{exact:true}).waitFor();await scope.getByText('插件原文',{exact:true}).waitFor();await scope.getByText('Restoration was blocked. Conflicts: none. Unsupported: 原文{path}.txt (the baseline cannot be safely restored).',{exact:true}).waitFor();await scope.getByText('原文{path}.txt',{exact:true}).first().waitFor();
   if(config.pkg)await scope.getByRole('heading',{name:'Blocked',exact:true}).waitFor();
   assert.equal(await page.evaluate(()=>window.diffCalls.filter(call=>call.command.includes('file_diff')).length),reads);
   if(config.pkg)assert.equal(await page.locator('.presentation-external iframe').first().getAttribute('data-probe-identity'),'same');
   await page.evaluate(async()=>{const {language}=await import('/src/lib/i18n/runtime.ts');language.set({preference:'zh-CN',locale:'zh-CN'});});await scope.getByText(zh,{exact:true}).waitFor();
  }
  await page.evaluate(async()=>{window.diffKey='truncated';await window.showTurnScenario();});
  await scope.getByText('… diff 已截断',{exact:false}).first().waitFor();
  const original=await page.evaluate(()=>window.inspectTurnScenario().diff);
  const calls=await page.evaluate(()=>window.diffCalls.length);
  await page.evaluate(async()=>{const {language}=await import('/src/lib/i18n/runtime.ts');language.set({preference:'en',locale:'en'});});
  await scope.getByText('… diff truncated',{exact:false}).first().waitFor();
  await scope.getByText('原文 {suffix}',{exact:false}).first().waitFor();
  assert.deepEqual(await page.evaluate(()=>window.inspectTurnScenario().diff),original);
  const beforeWrites=await page.evaluate(()=>window.diffCalls.filter(call=>call.command.includes('apply')).length);assert.equal(beforeWrites,0);
  assert.equal(await page.evaluate(()=>window.diffCalls.filter(call=>call.command.includes('file_diff')).length),await page.evaluate(calls=>window.diffCalls.slice(0,calls).filter(call=>call.command.includes('file_diff')).length,calls));
  if(config.pkg)assert.equal(await page.locator('.presentation-external iframe').first().getAttribute('data-probe-identity'),'same');
  await page.evaluate(async()=>{const {language}=await import('/src/lib/i18n/runtime.ts');language.set({preference:'zh-CN',locale:'zh-CN'});});
  await scope.getByText('… diff 已截断',{exact:false}).first().waitFor();
  assert.deepEqual(errors,[]);await page.close();console.log(`${config.kit}/${config.theme}/${config.pkg?.release.manifest.id??'builtin'}: turn reasons, persisted restore audit, raw provider text, same instance and literal paths passed`);
 }
}finally{await browser.close();await server.close();await skins.dispose();}
