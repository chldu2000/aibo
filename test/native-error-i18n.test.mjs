import {agentDiagnosticsPresentation} from '../src/lib/app/agent-diagnostics.ts';

test('Broker failure metadata retains nested host reasons and literal codes and invocation IDs',()=>{
 const localized={schema:'aibo.host-message/v1',key:'native.error.writeOutcomeUnknown',params:{error:{schema:'aibo.host-message/v1',key:'native.broker.invocationReason',params:{error:{schema:'aibo.host-message/v1',key:'native.broker.writeUnconfirmed',params:{code:'provider_raw {code}'}},id:'原始调用 /{id}'}}}};
 const error={code:'outcome_unknown',message:'原始结果诊断',invocationId:null,localized},original=structuredClone(error);
 const display=toErrorText(error);
 assert.equal(translateMessage('en',display),'The write result is unknown. Check the actual changes before continuing: Approved capability execution did not produce a confirmed result (provider_raw {code}); inspect its effects before another request; invocation 原始调用 /{id}');
 assert.equal(translateMessage('zh-CN',display),'写入结果未知，请核对实际更改后再操作：已批准的能力执行未产生确认结果（provider_raw {code}），请核对实际影响后再发起请求。；调用 原始调用 /{id}');
 assert.deepEqual(error,original);
 assert.equal(toErrorText({...error,localized:undefined}),'原始结果诊断');
 assert.equal(toErrorText({...error,localized:{...localized,key:'native.broker.unknown'}}),'原始结果诊断');
});

test('host goal continuation translates its explicit record while identical user and Agent text stays literal',()=>{
 const item={id:'goal-marker',sessionId:'s',turnId:'turn',externalMessageId:null,role:'user',toolName:null,status:'completed',content:'继续执行当前目标',localizedContent:{schema:'aibo.host-message/v1',key:'native.goal.resumePrompt',params:{}}};
 const original=structuredClone(item);
 for(const locale of ['zh-CN','en','zh-CN']){
  const value=timelinePresentation([item],locale)[0];
  assert.equal(value.content,locale==='en'?'Continue working on the current goal.':item.content);
  const {localizedContent,...raw}=item;assert.deepEqual(value,{...raw,content:value.content});
 }
 for(const change of [{localizedContent:undefined},{localizedContent:{}},{localizedContent:{...item.localizedContent,schema:'unknown'}},{localizedContent:{...item.localizedContent,key:'native.goal.unknown'}},{localizedContent:{...item.localizedContent,params:{invalid:NaN}}},{localizedContent:{...item.localizedContent,key:'native.session.closed'}},{localizedContent:undefined,localizedActivity:item.localizedContent},{role:'assistant'},{role:'system'},{role:'tool'},{status:'streaming'},{status:'failed'},{status:'queued'},{status:'interrupted'},{toolName:'goal'},{toolName:undefined},{turnId:null},{turnId:''},{turnId:undefined}]){
  const source={...item,...change};assert.equal(timelinePresentation([source],'en')[0].content,source.content);
 }
 assert.deepEqual(item,original);
});

test('forked background activity translates only its marked field while task snapshots and legacy activities remain literal',()=>{
 const task={id:'job',rootTurnId:'copied-turn',name:'任务名称 {name}',command:'echo 命令原文 {command}',activity:'任务属于原会话，分支不继承进程状态。',status:'unknown',exitCode:7,outputPath:'/用户/{path}',providerExtra:'提供者字段'};
 const item={id:'card',sessionId:'branch',role:'system',toolName:'background_task',status:'failed',content:JSON.stringify(task),localizedActivity:{schema:'aibo.host-message/v1',key:'native.background.forkActivity',params:{}}};
 const original=structuredClone(item);
 for(const locale of ['zh-CN','en','zh-CN']){
  const value=timelinePresentation([item],locale)[0],projected=JSON.parse(value.content);
  assert.equal(projected.activity,locale==='en'?'This task belongs to the source session. A branch does not inherit its process state.':task.activity);
  const {activity,...rest}=projected;const {activity:raw,...source}=task;assert.deepEqual(rest,source);
  assert.equal(value.status,item.status);assert.equal(value.id,item.id);assert.equal('localizedActivity' in value,false);
 }
 for(const change of [{localizedActivity:undefined},{localizedActivity:undefined,localizedContent:item.localizedActivity},{localizedActivity:{}},{localizedActivity:{...item.localizedActivity,key:'native.background.unknown'}},{localizedActivity:{...item.localizedActivity,schema:'unknown'}},{role:'user'},{role:'assistant'},{role:'tool'},{toolName:'subagent'},{status:'completed'},{status:'interrupted'},{content:'invalid JSON'},{content:JSON.stringify({...task,status:'running'})},{content:JSON.stringify({...task,status:'completed'})},{content:JSON.stringify({...task,command:null})}]){
  const source={...item,...change};assert.equal(timelinePresentation([source],'en')[0].content,source.content);
 }
 assert.deepEqual(item,original);
});

test('interrupted child activity translates only explicit host metadata and preserves task and process data',()=>{
 const task={id:'child',parentId:'parent',rootTurnId:'turn',name:'名称原文 {name}',task:'任务原文 {task}',activity:'执行已中断，已保留收到的过程记录。',status:'interrupted',providerExtra:{content:'过程原文 {content}'}};
 const item={id:'card',sessionId:'s',role:'system',toolName:'subagent',status:'failed',content:JSON.stringify(task),localizedActivity:{schema:'aibo.host-message/v1',key:'native.subagent.interruptedActivity',params:{}}};
 const original=structuredClone(item);
 for(const locale of ['zh-CN','en','zh-CN']){
  const value=timelinePresentation([item],locale)[0],child=JSON.parse(value.content);
  assert.equal(child.activity,locale==='en'?'Execution was interrupted. The received process records have been retained.':task.activity);
  const {activity,...rest}=child;const {activity:raw,...source}=task;assert.deepEqual(rest,source);
  assert.equal(value.status,'failed');assert.equal(value.id,'card');assert.equal('localizedActivity' in value,false);
 }
 for(const change of [{localizedActivity:undefined},{localizedActivity:{}},{localizedActivity:{...item.localizedActivity,key:'native.subagent.unknown'}},{localizedActivity:{...item.localizedActivity,schema:'unknown'}},{role:'assistant'},{role:'tool'},{role:'user'},{toolName:'shell'},{status:'completed'},{content:JSON.stringify({...task,status:'running'})},{content:'malformed JSON'},{content:JSON.stringify({...task,name:null})}]){
  const source={...item,...change};assert.equal(timelinePresentation([source],'en')[0].content,source.content);
 }
 assert.deepEqual(item,original);
});
import {workspaceCapabilityPresentation} from '../src/lib/app/workspace-capabilities.ts';
import {createFilePreviewController} from '../src/lib/app/file-preview-controller.ts';
import {createSearchController,searchPresentation,searchPreviewPresentation,searchCatalog,emptySearch} from '../src/lib/app/global-search.ts';
import {turnFileDiffPresentation,restoreOperationsPresentation,timelinePresentation,nativeListMessages,turnChangeSetPresentation,checkpointsPresentation} from '../src/lib/app/turn-change-presentation.ts';
import {workspaceFileDiffPresentation} from '../src/lib/app/workspace-file-diff.ts';
import {nodeRuntimeIssueMessages} from '../src/lib/app/node-runtime-controller.ts';
import { createSessionStartupController } from '../src/lib/app/session-startup-controller.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { translateMessage } from '../packages/i18n/index.js';
import { toErrorText } from '../src/lib/app/error-utils.ts';
import { createPluginInstallController } from '../src/lib/app/plugin-install-controller.ts';
import { createPluginLifecycleController } from '../src/lib/app/plugin-lifecycle-controller.ts';
import { createPluginAuthenticationController } from '../src/lib/app/plugin-authentication-controller.ts';
import { createArtifactPreviewController, artifactPreviewPresentation } from '../src/lib/app/artifact-preview-controller.ts';
import { createAgentSettingsController } from '../src/lib/app/agent-settings-controller.ts';
import { createSessionDiffController } from '../src/lib/app/session-diff-controller.ts';
const nativeError = () => ({code:'workspace_trust_required',message:'original diagnostic',localized:{schema:'aibo.host-message/v1',key:'native.error.workspaceTrust',params:{}}});
const reject = async () => { throw nativeError(); };
const check = value => {
  assert.equal(translateMessage('en',value),'This operation requires a trusted workspace. Confirm workspace trust first.');
  assert.equal(translateMessage('zh-CN',value),'此操作需要可信工作区。请先确认工作区可信。');
};

test('explicit native display metadata translates while codes, diagnostics and provider errors stay unchanged',()=>{
  const error=nativeError(),before=structuredClone(error);check(toErrorText(error));assert.deepEqual(error,before);
  for(const localized of [null,{key:'native.error.workspaceTrust',params:{}},{schema:'aibo.host-message/v1',key:'unknown',params:{}},{schema:'aibo.host-message/v1',key:'native.error.workspaceTrust',params:[]},{schema:'aibo.host-message/v1',key:'native.error.workspaceTrust',params:{invalid:{key:'unknown'}}}]){
    assert.equal(toErrorText({...error,localized}),'original diagnostic');
  }
  assert.equal(toErrorText({code:'workspace_trust_required',message:'插件原文'}),'插件原文','error codes alone do not rewrite provider text');
});

test('plugin installation, removal and authentication retain native descriptors through asynchronous state',async()=>{
  let install,lifecycle,authentication;
  const installer=createPluginInstallController({preview:reject,install:reject,undo:reject,undoTargets:async()=>[],refresh:async()=>{},publish:value=>install=value});
  await installer.review('/用户/package');check(install.error);assert.equal(install.busy,false);assert.equal(install.preview,null);
  const removal=createPluginLifecycleController({preview:reject,remove:reject,migrate:reject,refresh:async()=>{},publish:value=>lifecycle=value});
  await removal.review('installation');check(lifecycle.error);assert.equal(lifecycle.busy,false);assert.equal(lifecycle.impact,null);
  const auth=createPluginAuthenticationController({execute:reject,publish:value=>authentication=value});
  await auth.run('installation','login');check(authentication.entries.installation.error);assert.equal(authentication.busyId,null);
});

test('artifact and session diff errors translate only at display boundaries without changing ownership',async()=>{
  let artifact,diff;
  const preview=createArtifactPreviewController({read:reject,currentSession:()=> 's',available:()=>true,changed:value=>artifact=value});
  await preview.toggle('s','a');check(artifact.error);
  const en=artifactPreviewPresentation(artifact,'en'),zh=artifactPreviewPresentation(artifact,'zh-CN');
  assert.equal(en.sessionId,'s');assert.equal(en.artifactId,'a');assert.equal(en.error,translateMessage('en',artifact.error));assert.equal(zh.error,translateMessage('zh-CN',artifact.error));
  assert.equal(typeof en.error,'string');assert.equal(artifact.error.key,'native.error.workspaceTrust');
  preview.reset();assert.equal(artifact.error,null);
  const controller=createSessionDiffController(reject,value=>diff=value);
  await controller.open('w','r','用户文件.ts',false);check(diff.error);assert.equal(diff.repositoryId,'r');assert.equal(diff.path,'用户文件.ts');
  controller.close();assert.equal(diff.error,null);
});

test('Agent settings preserve native error metadata and raw provider conflict details',async()=>{
 let state;
 const target={installationId:'i',contributionId:'c',scope:{kind:'application'}};
 const controller=createAgentSettingsController({read:reject,save:reject,changed:value=>state=value});
 await controller.select(target);check(state.error);assert.deepEqual(state.target,target);
});

test('native startup errors retain nested messages and cannot change session ownership',async()=>{
 for(const phase of ['prepare','start']){
  let error,creating=false,selected=null;const sessions=new Map();
  const starting={id:'s',workspaceId:'w',pluginInstallationId:'p',state:'starting',archived:false};
  const controller=createSessionStartupController({prepare:phase==='prepare'?reject:async()=>starting,start:reject,getWorkspaceId:()=> 'w',getSessionId:()=>selected,findSession:id=>sessions.get(id),putSession:value=>sessions.set(value.id,value),selectSession:id=>selected=id,setCreating:value=>creating=value,setError:value=>error=value,setNotice(){},refreshProfile(){}});
  await controller.create('w','contribution','p');assert.equal(creating,false);
  if(phase==='prepare'){check(error);assert.equal(selected,null);assert.equal(sessions.size,0)}
  else {assert.equal(error.key,'startup.failed');check(error.params.error);assert.match(translateMessage('en',error),/^Session initialization failed: This operation/);assert.match(translateMessage('zh-CN',error),/^会话初始化失败：此操作/);assert.equal(sessions.get('s').state,'failed');assert.equal(sessions.get('s').pluginInstallationId,'p')}
 }
});

test('Node diagnostics use explicit native messages and preserve legacy or malformed details',()=>{
 const message={schema:'aibo.host-message/v1',key:'native.node.candidateFailed',params:{path:'/用户/{error}/node',error:{key:'native.node.notExecutable',params:{}}}};
 const status={issues:['原始诊断'],localizedIssues:[message]};
 const [display]=nodeRuntimeIssueMessages(status);
 assert.equal(translateMessage('en',display),'/用户/{error}/node: The file does not exist or is not executable.');
 assert.equal(translateMessage('zh-CN',display),'/用户/{error}/node：文件不存在或不可执行');
 for(const localizedIssues of [undefined,[],[{...message,key:'unknown'}],[{...message,params:{path:'/x',error:{key:'unknown'}}}]])assert.deepEqual(nodeRuntimeIssueMessages({...status,localizedIssues}),['原始诊断']);
 assert.deepEqual(nodeRuntimeIssueMessages({issues:['底层错误正文']}),['底层错误正文']);
 const error={code:'node_runtime_error',message:'原始诊断',localized:message};
 assert.equal(translateMessage('en',toErrorText(error)),translateMessage('en',display));
});


test('workspace diff projection translates explicit reasons and keeps patches, paths and legacy data intact',()=>{
 for(const key of ['untrackedTooLarge','binary','noChanges','commitEmpty']){
  const diff={path:'/用户/{reason}.txt',staged:true,available:false,truncated:false,diff:'原始补丁 {reason}',hunks:[],reason:'旧版诊断',localizedReason:{schema:'aibo.host-message/v1',key:'native.diff.'+key,params:{}}};
  const before=structuredClone(diff),en=workspaceFileDiffPresentation(diff,'en'),zh=workspaceFileDiffPresentation(diff,'zh-CN');
  assert.notEqual(en.reason,zh.reason);assert.equal(typeof en.reason,'string');assert.equal(en.diff,diff.diff);assert.equal(en.path,diff.path);assert.equal(en.staged,true);
  assert.equal('localizedReason' in en,false,'public presentation stays plain strings');assert.deepEqual(diff,before);
  for(const localizedReason of [undefined,null,{schema:'unknown',key:'native.diff.binary',params:{}},{schema:'aibo.host-message/v1',key:'native.diff.unknown',params:{}}]){
   assert.equal(workspaceFileDiffPresentation({...diff,localizedReason},'en').reason,'旧版诊断');
  }
  assert.equal(workspaceFileDiffPresentation({...diff,available:true,reason:null},'en').reason,null);
 }
 assert.equal(workspaceFileDiffPresentation(null,'en'),null);
});


test('turn diffs, restore reports and system history resolve explicit metadata at the display boundary',()=>{
 const display={schema:'aibo.host-message/v1',key:'native.restore.unsafeBaseline',params:{path:'/用户/{reason}.txt'}};
 const operation={id:'op',status:'blocked',restored:[],conflicts:['literal path'],unsupported:['原始诊断'],localizedConflicts:[null],localizedUnsupported:[display]};
 const original=structuredClone(operation);
 const en=restoreOperationsPresentation([operation],'en')[0],zh=restoreOperationsPresentation([operation],'zh-CN')[0];
 assert.equal(en.unsupported[0],'/用户/{reason}.txt (the baseline cannot be safely restored)');assert.equal(zh.unsupported[0],'/用户/{reason}.txt（baseline 不可安全恢复）');
 assert.equal('localizedUnsupported' in en,false);assert.deepEqual(operation,original);assert.deepEqual(en.conflicts,['literal path']);
 for(const metadata of [null,[],[{}],{items:[display]}])assert.deepEqual(nativeListMessages(['原文'],metadata),['原文']);
 const diff={path:'/用户/{reason}.txt',available:false,diff:'原始补丁',hunks:[],reason:'原始原因',localizedReason:{schema:'aibo.host-message/v1',key:'native.turn.binary',params:{}}};
 assert.equal(turnFileDiffPresentation(diff,'en').reason,'Hunk operations are unavailable for binary files.');assert.equal(turnFileDiffPresentation({...diff,localizedReason:null},'en').reason,'原始原因');
 assert.equal(turnFileDiffPresentation(diff,'en').diff,'原始补丁');assert.equal('localizedReason' in turnFileDiffPresentation(diff,'en'),false);
 const audit={schema:'aibo.host-message/v1',key:'native.restore.auditBlocked',params:{conflicts:{kind:'list',items:['literal path']},unsupported:{kind:'list',items:[display]}}};
 const items=['system','assistant','user','tool'].map(role=>({id:role,role,content:'原始正文',localizedContent:audit}));
 const projected=timelinePresentation(items,'en');assert.equal(projected[0].content,'Restoration was blocked. Conflicts: literal path. Unsupported: /用户/{reason}.txt (the baseline cannot be safely restored).');
 for(const item of projected.slice(1)){assert.equal(item.content,'原始正文');assert.equal('localizedContent' in item,false);}
 assert.equal(timelinePresentation([{...items[0],localizedContent:{...audit,params:{conflicts:[],unsupported:''}}}],'en')[0].content,'原始正文');
 assert.equal(timelinePresentation([{...items[0],localizedContent:{...audit,params:{conflicts:{kind:'list',items:[{}]},unsupported:''}}}],'en')[0].content,'原始正文');
});


test('search titles, descriptions, warnings and non-text previews switch language without changing identities or reading again',async()=>{
 const display=(key,params={})=>({schema:'aibo.host-message/v1',key,params});
 const item={id:'message:m',kind:'message',title:'助手消息',description:'原始诊断',excerpt:'原始用户正文',target:{source:'message',id:'m',workspaceId:'w',sessionId:'s'},score:50,localizedTitle:display('native.search.assistant'),localizedDescription:display('native.search.description',{base:'用户{path} · 原文会话',archived:{key:'native.search.archived',params:{prefix:' · '}},line:{key:'native.search.line',params:{line:2}}})};
 let state,reads=0;const page={items:[item],hasMore:false,warnings:['原始诊断','插件原文'],localizedWarnings:[display('native.search.namedWarning',{name:'原文工作区',warning:{key:'native.search.directoryLimit',params:{}}}),null]};
 const before=structuredClone(page),controller=createSearchController({sources:[{id:'files',search:async()=>{reads++;return page;}}],publish:value=>state=value});
 await controller.search('用户正文',null,'w');const en=searchPresentation(state,'en'),zh=searchPresentation(state,'zh-CN');
 assert.equal(en.items[0].title,'Assistant message');assert.equal(zh.items[0].title,'助手消息');assert.equal(en.items[0].description,'用户{path} · 原文会话 · Archived · Line 2');
 assert.deepEqual(en.items[0].target,item.target);assert.equal(en.items[0].id,item.id);assert.equal(en.items[0].score,50);assert.equal(en.items[0].excerpt,'原始用户正文');assert.equal('localizedTitle' in en.items[0],false);
 assert.equal(translateMessage('en',state.warnings[0]),'原文工作区: The directory is too large to index completely. Narrow the workspace scope.');assert.equal(state.warnings[1],'插件原文');assert.equal(reads,1);assert.deepEqual(page,before);
 for(const localizedWarnings of [undefined,[],[{},null]]){
  const fallback=createSearchController({sources:[{id:'files',search:async()=>({...page,localizedWarnings})}],publish:value=>state=value});await fallback.search('same');assert.deepEqual(state.warnings,page.warnings);
 }
 const preview={title:'用户.png',content:'此附件为非文本内容；可在所属会话查看。',localizedContent:display('native.search.nonText'),target:item.target,truncated:false};
 assert.equal(searchPreviewPresentation(preview,'en').content,'This attachment is not text. View it in its session.');assert.equal(searchPreviewPresentation({...preview,localizedContent:null},'en').content,preview.content);
 assert.equal(searchPreviewPresentation(null,'en'),null);
});


test('local search catalog labels refresh without replacing result identity or translating other sources',()=>{
 const local={id:'command:settings',kind:'command',title:'打开工作台设置',description:'原始说明',score:1,target:{source:'command',id:'settings'}};
 const page=searchCatalog([local],{query:'设置',kind:'command',workspaceId:null,limit:50});
 const state={...emptySearch(),items:page.items};const before=structuredClone(state);
 const catalog=[{...local,title:'Open workbench settings',description:'Current settings description'}];
 const displayed=searchPresentation(state,'en',catalog).items[0];assert.equal(displayed.title,'Open workbench settings');assert.equal(displayed.description,'Current settings description');assert.deepEqual(displayed.target,local.target);assert.equal(displayed.score,page.items[0].score);assert.equal('hostCatalog' in displayed,false);assert.deepEqual(state,before);
 assert.equal(searchPresentation({...state,items:[{...local,hostCatalog:false}]},'en',catalog).items[0].title,local.title);
 assert.equal(searchPresentation(state,'en',[{...catalog[0],target:{source:'provider',id:'settings'}}]).items[0].title,local.title);
});


test('native read failures switch display language without repeating reads or rewriting original errors',async()=>{
 let state,reads=0;
 const error={code:'session_operation_error',message:'session operation failed: 二进制文件不提供文本预览',localized:{schema:'aibo.host-message/v1',key:'native.search.binaryPreview',params:{}}};
 const original=structuredClone(error);
 const controller=createFilePreviewController(async()=>{reads++;throw error},value=>state=value);
 await controller.open('session','用户/{error}.bin',42);
 assert.equal(translateMessage('en',state.error),'Text previews are unavailable for binary files.');
 assert.equal(translateMessage('zh-CN',state.error),'二进制文件不提供文本预览');
 assert.equal(translateMessage('en',state.error),'Text previews are unavailable for binary files.');
 assert.equal(reads,1);assert.equal(state.sessionId,'session');assert.equal(state.path,'用户/{error}.bin');assert.equal(state.line,42);assert.deepEqual(error,original);
 assert.equal(toErrorText({code:error.code,message:'provider 原始错误'}),'provider 原始错误');
 controller.close();assert.equal(state.error,null);
});


test('recovered turn capture errors change only display and retain raw evidence and ownership',()=>{
 const display={schema:'aibo.host-message/v1',key:'native.recovery.captureFailed',params:{error:'底层错误 {error}'}};
 const value={id:'set',sessionId:'s',workspaceId:'w',turnId:'t',captureStatus:'failed',captureError:'原始诊断',attribution:'unknown',files:[{path:'用户文件'}],localizedCaptureError:display};
 const original=structuredClone(value),en=turnChangeSetPresentation(value,'en'),zh=turnChangeSetPresentation(value,'zh-CN');
 assert.equal(en.captureError,'Rebuilt after the app restarted; the result could not be captured: 底层错误 {error}');
 assert.equal(zh.captureError,'应用重启后重建；无法采集结果：底层错误 {error}');
 assert.equal('localizedCaptureError' in en,false);assert.deepEqual(value,original);
 for(const key of ['id','sessionId','workspaceId','turnId','captureStatus','attribution','files'])assert.deepEqual(en[key],value[key]);
 for(const localizedCaptureError of [undefined,null,{}, {...display,key:'native.recovery.unknown'},{...display,schema:'invalid'}])assert.equal(turnChangeSetPresentation({...value,localizedCaptureError},'en').captureError,'原始诊断');
 assert.equal(turnChangeSetPresentation({...value,captureError:null},'en').captureError,null);assert.equal(turnChangeSetPresentation(null,'en'),null);
});


test('checkpoint reasons use explicit metadata while retaining restore evidence and legacy text',()=>{
 const item={id:'c',sessionId:'s',workspaceId:'w',turnId:'t',path:'原文 {reason}',available:false,baselineDirty:true,fileExists:true,contentHash:'hash',storagePath:null,size:7,reason:'原始原因',localizedReason:{schema:'aibo.host-message/v1',key:'native.checkpoint.unavailable',params:{}}};
 const original=structuredClone(item),en=checkpointsPresentation([item],'en')[0],zh=checkpointsPresentation([item],'zh-CN')[0];
 assert.equal(en.reason,'The baseline file is too large, cannot be hashed, or its checkpoint file is unavailable.');assert.equal(zh.reason,'baseline 文件过大、不可哈希或 checkpoint 文件不可用');
 assert.equal('localizedReason' in en,false);assert.deepEqual(item,original);
 for(const key of ['id','sessionId','workspaceId','turnId','path','available','baselineDirty','fileExists','contentHash','storagePath','size'])assert.deepEqual(en[key],item[key]);
 for(const localizedReason of [undefined,null,{}, {...item.localizedReason,key:'native.checkpoint.unknown'}])assert.equal(checkpointsPresentation([{...item,localizedReason}],'en')[0].reason,'原始原因');
 assert.equal(checkpointsPresentation([{...item,available:true,reason:null}],'en')[0].reason,null);
});

test('queue admission errors retain explicit metadata without inferring provider diagnostics',()=>{
 for(const [key,zh,en] of [
  ['resumeUncertain','请先核对并移除投递结果未知的消息。','Check and remove messages with unknown delivery results before resuming.'],
  ['sendUncertain','消息投递结果未知，请核对会话记录后删除该条，避免重复发送。','Delivery is unknown. Check the conversation history and delete this message to avoid sending it twice.'],
  ['full','队列已满（100 条消息），请移除消息后再添加。','The queue is full (100 messages). Remove a message before adding another.'],
  ['actionRequired','请选择队列操作。','Choose a queue action.'],
  ['messageRequired','请提供要加入队列的消息。','Provide a message to add to the queue.'],
  ['idRequired','请选择队列中的消息。','Choose a queued message.'],
  ['unknownAction','不支持此队列操作。','This queue action is not supported.'],
  ['missing','这条排队消息已不存在。','This queued message no longer exists.'],
  ['sending','这条消息正在发送。','This message is already being sent.'],
  ['stopping','会话正在停止，请停止后重试。','The session is stopping. Try again after it stops.'],
  ['finishing','会话仍在结束当前回合，请完成后重试。','The session is still finishing its turn. Try again after it finishes.'],
 ]){
  const error={message:zh,localized:{schema:'aibo.host-message/v1',key:'native.queue.'+key,params:{}}},before=structuredClone(error);
  const text=toErrorText(error);assert.equal(translateMessage('en',text),en);assert.equal(translateMessage('zh-CN',text),zh);assert.deepEqual(error,before);
  assert.equal(toErrorText(zh),zh);assert.equal(toErrorText({message:zh}),zh);
 }
});

test('explicit truncation suffixes translate while raw text, earlier hunks and legacy inputs stay literal',()=>{
 const suffix={schema:'aibo.host-message/v1',key:'native.diff.truncatedSuffix',params:{}};
 const marker='\n… diff 已截断',enMarker='\n… diff truncated';
 const raw='@@ original {suffix}\n+用户正文'+marker;
 const diff={path:'用户/{suffix}.txt',staged:true,available:true,truncated:true,diff:raw+marker,hunks:[{index:0,header:'@@ original',content:raw},{index:1,header:'@@ last',content:raw+marker}],reason:null,localizedSuffix:suffix};
 const original=structuredClone(diff);
 for(const project of [workspaceFileDiffPresentation,turnFileDiffPresentation]){
  const en=project(diff,'en'),zh=project(diff,'zh-CN');
  assert.equal(en.diff,raw+enMarker);assert.equal(en.hunks[0].content,raw);assert.equal(en.hunks[1].content,raw+enMarker);
  assert.equal(zh.diff,diff.diff);assert.deepEqual(zh.hunks,diff.hunks);assert.equal('localizedSuffix' in en,false);
  assert.equal(en.path,diff.path);assert.deepEqual(en.hunks.map(h=>[h.index,h.header]),diff.hunks.map(h=>[h.index,h.header]));
  for(const localizedSuffix of [undefined,null,{}, {...suffix,schema:'invalid'},{...suffix,key:'native.diff.unknown'},{...suffix,key:'native.diff.binary'}]){
   const legacy=project({...diff,localizedSuffix},'en');assert.equal(legacy.diff,diff.diff);assert.deepEqual(legacy.hunks,diff.hunks);
  }
  const mismatched=project({...diff,diff:'raw without marker'},'en');assert.equal(mismatched.diff,'raw without marker');assert.deepEqual(mismatched.hunks,diff.hunks);
 }
 assert.deepEqual(diff,original);
 const searchMarker='\n…内容过长，预览已截断';
 const preview={title:'原文',content:'正文 {suffix}'+searchMarker+searchMarker,truncated:true,target:{source:'message',id:'m'},localizedSuffix:{...suffix,key:'native.search.truncatedSuffix'}};
 const saved=structuredClone(preview),en=searchPreviewPresentation(preview,'en');
 assert.equal(en.content,'正文 {suffix}'+searchMarker+'\n…Content is too long; the preview was truncated.');
 assert.equal('localizedSuffix' in en,false);assert.deepEqual(en.target,preview.target);assert.deepEqual(preview,saved);
 assert.equal(searchPreviewPresentation({...preview,localizedSuffix:null},'en').content,preview.content);
});

test('Git unknown outcomes translate nested host reasons while output and legacy diagnostics stay literal',()=>{
 const output='原文 {output}\n… Git 输出已截断';
 const localized={schema:'aibo.host-message/v1',key:'native.error.writeOutcomeUnknown',params:{error:{key:'native.git.stopped',params:{action:'原始{action}',output:{key:'native.git.truncatedOutput',params:{output}}}}}};
 const error={code:'outcome_unknown',message:'原始诊断',localized},before=structuredClone(error),display=toErrorText(error);
 const en=translateMessage('en',display),zh=translateMessage('zh-CN',display);
 assert.equal(en,'The write result is unknown. Check the actual changes before continuing: Git 原始{action} stopped; some changes may already have taken effect.\n'+output+'\n… Git output truncated');
 assert.equal(zh,'写入结果未知，请核对实际更改后再操作：Git 原始{action} 已停止，部分更改可能已生效。\n'+output+'\n… Git 输出已截断');assert.deepEqual(error,before);
 assert.equal(toErrorText({code:error.code,message:error.message}),'原始诊断');
});


test('persisted partial restore audit renders nested write reasons within the display depth limit',()=>{
 const raw='OS 原文 {path}';
 const reason={key:'native.turn.restoreWriteFailed',params:{path:'原始 {error}.txt',error:raw}};
 const partial={key:'native.restore.partialFailure',params:{path:'原始 {error}.txt',restored:'["原始路径"]',error:reason}};
 const unknown={key:'native.error.writeOutcomeUnknown',params:{error:partial}};
 const audit={schema:'aibo.host-message/v1',key:'native.restore.auditIncomplete',params:{error:unknown}};
 const error={message:'legacy diagnostic',localized:audit},before=structuredClone(error);
 const display=toErrorText(error);
 assert.match(translateMessage('en',display),/^Turn restoration did not finish: The write result is unknown/);
 assert.ok(translateMessage('en',display).includes('Restoring file 原始 {error}.txt failed.'));
 assert.ok(translateMessage('en',display).includes(raw));
 assert.ok(translateMessage('zh-CN',display).includes('恢复文件 原始 {error}.txt 时出错'));
 assert.deepEqual(error,before);
});


test('plugin diagnostics translate only explicit host metadata and preserve readiness and raw text', async () => {
  const {pluginDiagnosticsPresentation} = await import('../src/lib/app/plugin-diagnostics.ts');
  const installation = {id:'release',enabled:false,runnable:false,dependencies:[
    {name:'程序 {range}',required:true,available:false,issue:'version does not satisfy >=999',localizedIssue:{schema:'aibo.host-message/v1',key:'native.dependency.versionMismatch',params:{range:'>=999 {range}'}}},
    {name:'third-party',required:false,available:false,issue:'version probe failed'},
    {name:'unknown',required:false,available:false,issue:'插件原文',localizedIssue:{schema:'aibo.host-message/v1',key:'native.unknown',params:{}}},
    {name:'available',required:true,available:true,issue:null},
  ]};
  const before = structuredClone(installation);
  const en = pluginDiagnosticsPresentation(installation,'en');
  const zh = pluginDiagnosticsPresentation(installation,'zh-CN');
  assert.equal(en.dependencies[0].issue,'version does not satisfy >=999 {range}');
  assert.equal(zh.dependencies[0].issue,'版本不满足 >=999 {range}');
  for (const projected of [en,zh]) {
    assert.equal(projected.dependencies[0].name,'程序 {range}');
    assert.equal(projected.runnable,false);assert.equal(projected.enabled,false);
    assert.equal(projected.dependencies[1].issue,'version probe failed');
    assert.equal(projected.dependencies[2].issue,'插件原文');
    assert.equal(projected.dependencies[3].issue,null);
    assert.ok(projected.dependencies.every(dependency => !('localizedIssue' in dependency)));
  }
  assert.deepEqual(installation,before);
});


test('plugin activation diagnostics retain literal identifiers and fall back on invalid parallel metadata', async () => {
  const {pluginDiagnosticsPresentation} = await import('../src/lib/app/plugin-diagnostics.ts');
  const localized = {schema:'aibo.host-message/v1',key:'native.activation.unsupported',params:{id:'贡献 {id}',kind:'semanticView',operation:{key:'native.activation.noOperation',params:{}}}};
  const original = {id:'release',dependencies:[],runnable:false,enabled:false,activationIssues:['原始宿主诊断','插件原文'],localizedActivationIssues:[localized,{schema:'aibo.host-message/v1',key:'native.unknown',params:{}}]};
  const before = structuredClone(original);
  const en = pluginDiagnosticsPresentation(original,'en');
  const zh = pluginDiagnosticsPresentation(original,'zh-CN');
  assert.equal(en.activationIssues[0],'Required contribution 贡献 {id} is unsupported (type: semanticView, operation: no specific operation). Check the runtime protocol, semantic version, scope, and permissions.');
  assert.equal(zh.activationIssues[0],'必需贡献 贡献 {id} 不受支持（类型：semanticView，操作：无具体操作）；请检查 runtime 协议、语义版本、作用域和权限。');
  for (const projected of [en,zh]) {
    assert.equal(projected.activationIssues[1],'插件原文');
    assert.equal(projected.runnable,false);assert.equal(projected.enabled,false);
    assert.ok(!('localizedActivationIssues' in projected));
  }
  for (const metadata of [undefined,[],[localized],[localized,localized,localized]]) {
    assert.deepEqual(pluginDiagnosticsPresentation({...original,localizedActivationIssues:metadata},'en').activationIssues,original.activationIssues);
  }
  assert.deepEqual(original,before);
});


test('package dependency projection retains pins, contribution gates and raw diagnostics', async () => {
  const {pluginDiagnosticsPresentation} = await import('../src/lib/app/plugin-diagnostics.ts');
  const original={id:'release',runnable:false,dependencies:[],packageDependencies:{unavailableContributions:['原文.contribution'],dependencies:[
    {pluginId:'插件 {plugin}',required:true,available:false,installationId:'pinned',version:'1.2.3',contributionIds:['原文.contribution'],issue:'dependency_unavailable: selected release is disabled',localizedIssue:{schema:'aibo.host-message/v1',key:'native.packageDependency.disabled',params:{}}},
    {pluginId:'raw',required:false,available:false,issue:'第三方诊断'},
  ]}};
  const before=structuredClone(original);
  const en=pluginDiagnosticsPresentation(original,'en'),zh=pluginDiagnosticsPresentation(original,'zh-CN');
  assert.equal(en.packageDependencies.dependencies[0].issue,'The selected release is disabled.');
  assert.equal(zh.packageDependencies.dependencies[0].issue,'选定版本已禁用。');
  for (const projected of [en,zh]) {
    const dependency=projected.packageDependencies.dependencies[0];
    assert.equal(dependency.pluginId,'插件 {plugin}');assert.equal(dependency.installationId,'pinned');assert.equal(dependency.version,'1.2.3');
    assert.equal(dependency.available,false);assert.equal(projected.runnable,false);
    assert.deepEqual(projected.packageDependencies.unavailableContributions,['原文.contribution']);
    assert.ok(!('localizedIssue' in dependency));assert.equal(projected.packageDependencies.dependencies[1].issue,'第三方诊断');
  }
  assert.deepEqual(original,before);
});


test('context control notices translate only system display metadata and preserve mode labels and raw history',()=>{
 const label='模式原文 {label}';
 const fixtures=[
  ['native.session.controlChanged',{label},`审批后切换到 ${label}`,`Switched to ${label} after approval`],
  ['native.session.controlResetChanged',{label},`审批后清空上下文并切换到 ${label}`,`Cleared the context and switched to ${label} after approval`],
  ['native.session.contextResetResumed',{},'会话已恢复。之前批准计划时清空过上下文，恢复后 Agent 的上下文可能不包含清空之后的对话与操作；时间线保留了完整记录。','The session has resumed. Its context was cleared when the plan was approved. The restored Agent context may omit conversations and actions after that reset; the timeline retains the complete record.'],
 ];
 for(const [key,params,zh,en] of fixtures){
  const items=['system','assistant','user','tool'].map(role=>({id:role,sessionId:'s',role,content:zh,localizedContent:{schema:'aibo.host-message/v1',key,params}}));
  const original=structuredClone(items);
  for(const locale of ['zh-CN','en','zh-CN']){
   const projected=timelinePresentation(items,locale);
   assert.equal(projected[0].content,locale==='en'?en:zh);
   assert.equal(projected[0].id,'system');
   for(const item of projected.slice(1))assert.equal(item.content,zh);
   for(const item of projected)assert.equal('localizedContent' in item,false);
  }
  for(const metadata of [null,{schema:'unknown',key,params},{schema:'aibo.host-message/v1',key:'native.session.unknown',params}])assert.equal(timelinePresentation([{...items[0],localizedContent:metadata}],'en')[0].content,zh);
  assert.deepEqual(items,original);
 }
});


test('workspace inventory warnings translate aligned host metadata while keeping raw entries, scope and legacy warnings',()=>{
 const display=(key,params)=>({schema:'aibo.host-message/v1',key,params});
 const cases=[
  ['skillRead',{path:'.codex/技能 {path}',error:'底层原文 {error}'},'Unable to read skill directory .codex/技能 {path}: 底层原文 {error}'],
  ['mcpRead',{path:'目录/.mcp.json',error:'底层原文 {error}'},'Unable to read MCP configuration 目录/.mcp.json: 底层原文 {error}'],
  ['mcpJson',{path:'目录/.mcp.json',error:'parser: raw {error}'},'MCP configuration 目录/.mcp.json is not valid JSON: parser: raw {error}'],
  ['mcpServers',{path:'目录/.mcp.json'},'MCP configuration 目录/.mcp.json is missing mcpServers/servers.'],
 ];
 const inventory={workspaceId:'w',inspectedAt:'unchanged',instructions:[{name:'AGENTS.md',source:'workspace'}],skills:[{name:'技能 {id}',source:'.codex/skills'}],tools:[{name:'tool.raw',source:'aibo-core'}],mcpServers:[{name:'服务器 {id}',source:'.mcp.json'}],warnings:cases.map((_,i)=>'原始诊断 '+i).concat('第三方原文 {key}'),localizedWarnings:cases.map(([key,params])=>display('native.inventory.'+key,params)).concat(null)};
 const original=structuredClone(inventory);
 const projected=workspaceCapabilityPresentation(inventory,'en');
 assert.deepEqual(projected.warnings,cases.map(item=>item[2]).concat('第三方原文 {key}'));
 assert.equal('localizedWarnings' in projected,false);
 const {warnings,...rest}=projected;const {warnings:raw,localizedWarnings,...source}=inventory;assert.deepEqual(rest,source);
 for(const metadata of [null,[],[{}],inventory.localizedWarnings.map(()=>({schema:'aibo.host-message/v1',key:'native.inventory.unknown',params:{}}))])assert.deepEqual(workspaceCapabilityPresentation({...inventory,localizedWarnings:metadata},'en').warnings,inventory.warnings);
 assert.deepEqual(inventory,original);assert.equal(workspaceCapabilityPresentation(null,'en'),null);
});


test('agent diagnostic projection translates explicit host messages and preview versions without changing readiness or raw identity',()=>{
 const item={agent:'third.party',label:'程序原文 {label}',status:'ready',authState:'delegated',capabilities:['capability.raw'],executable:'/用户/{path}',version:'detected at runtime',message:'原始说明',localizedVersion:{schema:'aibo.host-message/v1',key:'native.diagnostics.previewRuntimeVersion',params:{}},localizedMessage:{schema:'aibo.host-message/v1',key:'native.diagnostics.probeRun',params:{label:'程序原文 {label}',error:'底层原文 {error}'}}};
 const original=structuredClone(item);
 const value=agentDiagnosticsPresentation([item],'en')[0];assert.equal(value.message,'Unable to run 程序原文 {label}: 底层原文 {error}');assert.equal(value.version,'Detected at runtime');
 assert.equal('localizedMessage' in value,false);assert.equal('localizedVersion' in value,false);
 const {message,version,...rest}=value;const {message:rawMessage,version:rawVersion,localizedVersion,localizedMessage,...source}=item;assert.deepEqual(rest,source);assert.deepEqual(item,original);
 for(const metadata of [null,{}, {...localizedMessage,key:'native.diagnostics.unknown'}, {...localizedMessage,schema:'unknown'}]){
  const fallback=agentDiagnosticsPresentation([{...item,localizedMessage:metadata,localizedVersion:metadata}],'en')[0];assert.equal(fallback.message,item.message);assert.equal(fallback.version,item.version);
 }
 assert.equal(agentDiagnosticsPresentation([{...item,message:null,version:null}],'en')[0].message,null);
 assert.equal(agentDiagnosticsPresentation([{...item,message:null,version:null}],'en')[0].version,null);
});


test('semantic catalog display strips host metadata and preserves identity, title and readiness', async()=>{
 const {semanticContributionPresentation}=await import('../src/lib/app/plugin-diagnostics.ts');
 const localizedIssue={schema:'aibo.host-message/v1',key:'native.semantic.unavailableIssue',params:{}};
 const contribution={installationId:'原文 {id}',contributionId:'view',title:'依赖或语义版本不可用',scope:'workspace',available:false,issue:'依赖或语义版本不可用',localizedIssue};
 const original=structuredClone(contribution);
 const en=semanticContributionPresentation(contribution,'en');
 assert.equal(en.issue,'Dependencies or the semantic version are unavailable.');
 assert.equal(semanticContributionPresentation(contribution,'zh-CN').issue,contribution.issue);
 const {issue,localizedIssue:internal,...canonical}=contribution;
 const {issue:display,...plain}=en;assert.deepEqual(plain,canonical);assert.deepEqual(contribution,original);
 for(const metadata of [undefined,null,{}, {...localizedIssue,key:'native.semantic.futureMessage'},{...localizedIssue,schema:'invalid'}]){
  assert.equal(semanticContributionPresentation({...contribution,localizedIssue:metadata},'en').issue,contribution.issue);
 }
});
