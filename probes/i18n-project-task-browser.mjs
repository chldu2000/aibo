import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {translateMessage} from '../packages/i18n/index.js';
import {buildPresentationSkins} from './lib/build-presentation-skins.mjs';
const skins=await buildPresentationSkins();
const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false,watch:null},plugins:[{
 name:'observe-project-task',enforce:'pre',transform(code,id){
  if(!id.endsWith('/src/App.svelte'))return;
  const marker='  const capabilityWorkbenchDirectory =';assert.ok(code.includes(marker));
  return code.replace(marker,`  if(typeof window!=='undefined')Object.assign(window,{prepareProjectTaskFixture(failure,status){window.taskFailure=failure;window.taskResultStatus=status;errorMessage=null;notice=null;},prepareProjectOutputFixture(value){window.taskFailure=null;window.taskResultStatus=value.status;window.taskOutputFixture=value;errorMessage=null;notice=null;},inspectProjectTaskPublicFixture(){return JSON.parse(JSON.stringify(externalInspector.projectActionRuns));},openProjectTaskHistoryFixture(){openExecutionHistory();},inspectProjectTaskHistoryFixture(){return JSON.parse(JSON.stringify(executionHistory));},inspectProjectTaskFixture(){return JSON.parse(JSON.stringify({actions:projectActions,runs:projectActionRuns,running:projectRunningActions,workspace:selectedWorkspaceId,session:selectedSessionId,error:errorMessage,notice,editor:projectEditors[selectedWorkspaceId??'']??null}));}});\n${marker}`);
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
   // Isolate locale-triggered reads from the independent task-history poll.
   const timeout=window.setTimeout.bind(window);window.setTimeout=(callback,delay,...args)=>timeout(delay===750?()=>{}:callback,delay,...args);
   localStorage.setItem('aibo.language.v1','zh-CN');localStorage.setItem('aibo.appearance.v1',JSON.stringify({kitId:kit,themeId:theme}));
   localStorage.setItem('aibo.workbench-layout.v1.main',JSON.stringify({activeView:'context',auxiliaryOpen:true}));
   const action={schema:'aibo.project-action/v1',id:'action原文 /{id}',workspaceId:'w',name:'任务原文 {name}',kind:'test',program:'/原文/{program}',args:['原文 /{arg}'],cwd:'.',enabled:true,createdAt:'now',updatedAt:'now'};
   window.taskCalls=[];window.taskRuns=[];let callback=0;
   window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback(fn){const id=++callback;window['_'+id]=fn;return id},unregisterCallback(id){delete window['_'+id]},async invoke(command,args={}){
    window.taskCalls.push({command,args});
    if(command.startsWith('plugin:event|'))return 1;
    if(command==='get_app_snapshot')return {platform:'macos',appVersion:'probe',workspaceCount:1,diagnostics:[]};
    if(command==='list_workspaces')return [{id:'w',label:'工作区原文',path:'/原文/{workspace}',trust:'trusted',createdAt:'now',updatedAt:'now'}];
    if(command==='read_workspace_preferences')return {trustNewWorkspaces:true};
    if(command==='get_workspace_changes')return {workspaceId:'w',dirty:false,files:[],captureStatus:'captured'};
    if(command==='list_workspace_git_repositories')return {repositories:[],limited:false,warnings:[]};
    if(command==='inspect_workspace_capabilities')return {workspaceId:'w',instructions:[],skills:[],tools:[],mcpServers:[],warnings:[]};
    if(command==='get_presentation_selection')return pkg?{digest:pkg.release.digest,themeId:pkg.release.manifest.themes[0].id}:null;
    if(command==='list_presentation_packages')return pkg?[pkg.release]:[];
    if(command==='read_presentation_package')return pkg;
    if(command==='get_composer_draft'||command==='get_turn_change_set')return null;
    if(command==='list_project_actions')return [action];
    if(command==='list_project_action_runs')return window.taskRuns;
    if(command==='run_project_action'){
     if(window.taskFailure)throw window.taskFailure;
     const run={schema:'aibo.project-action-run/v3',id:'run原文 /{id}',actionId:action.id,actionName:action.name,workspaceId:'w',sessionId:null,status:window.taskResultStatus,exitCode:0,output:window.taskOutputFixture?.output??'命令输出原文 /{output}',localizedOutput:window.taskOutputFixture?.metadata,artifactId:null,startedAt:'now',completedAt:'now'};
     window.taskRuns=[run];return run;
    }
    return [];
   }};
  },config);
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
  await page.waitForFunction(()=>typeof window.inspectProjectTaskFixture==='function'&&window.taskCalls.some(call=>call.command==='list_project_actions'));
  const scope=config.pkg?page.frameLocator('.presentation-external iframe').first():page;
  const run=()=>scope.getByRole('button',{name:config.pkg?'运行 任务原文 {name}':'运行',exact:true});
  await run().waitFor();
  const frame=config.pkg?await page.locator('.presentation-external iframe').first().elementHandle():null;
  const settle=()=>config.pkg?page.waitForTimeout(250):Promise.resolve();
  const language=async locale=>{await page.evaluate(async locale=>{const {language}=await import('/src/lib/i18n/runtime.ts');language.set({preference:locale,locale});},locale);await settle();};
  const failure={code:'invalid_workspace_path',message:'诊断原文 /{message}'};
  const keys=['name','kind','program','argsLimit','cwd','workspace','requestConflict','disabled','sessionWorkspace','taskCwd','requestId','summaryLimit','admissionMissing','approvalMissing','recordChanged','storedArgs','serializeArgs','missing'];
  const failures=keys.map(key=>({...failure,localized:{schema:'aibo.host-message/v1',key:'native.project.'+key,params:{error:'底层原文 /{error}',id:'动作ID原文 /{id}'}}}));
  failures.push(failure,{...failure,localized:{schema:'invalid',key:'native.project.disabled',params:{}}},{...failure,localized:{schema:'aibo.host-message/v1',key:'native.project.unknown',params:{}}});
  const noticeKeys={rejected:'app.projectRejected',awaiting_approval:'app.projectAwaiting',running:'app.projectRunning',outcome_unknown:'app.projectUnknown',completed:'app.projectCompleted',timed_out:'app.projectTimedOut',failed:'app.projectFailed'};
  for(const fixture of [...failures.map(failure=>({failure,status:null})),...Object.keys(noticeKeys).map(status=>({failure:null,status}))]){
   await page.evaluate(({failure,status})=>window.prepareProjectTaskFixture(failure,status),fixture);
   await settle();
   const count=await page.evaluate(()=>window.taskCalls.filter(call=>call.command==='run_project_action').length);
   await run().click();await settle();
   const expected=locale=>fixture.failure?fixture.failure.localized?.schema==='aibo.host-message/v1'&&fixture.failure.localized.key!=='native.project.unknown'?translateMessage(locale,fixture.failure.localized):fixture.failure.message:translateMessage(locale,{key:noticeKeys[fixture.status],params:{}});
   try{await page.getByText(expected('zh-CN'),{exact:true}).waitFor();}
   catch(error){await writeFile('/tmp/aibo-i18n-project-task-failure-135.json',JSON.stringify({config:{kit:config.kit,theme:config.theme,package:config.pkg?.release.manifest.id},fixture,count,state:await page.evaluate(()=>window.inspectProjectTaskFixture()),calls:await page.evaluate(()=>window.taskCalls),body:await page.locator('body').innerText()},null,2));throw error;}
   const before=await page.evaluate(()=>window.inspectProjectTaskFixture());
   assert.equal(before.workspace,'w');assert.equal(before.session,null);assert.equal(before.running.w,null);
   const request=await page.evaluate(()=>window.taskCalls.filter(call=>call.command==='run_project_action').at(-1).args);
   assert.equal(request.workspaceId,'w');assert.equal(request.actionId,'action原文 /{id}');assert.equal(request.sessionId,null);assert.match(request.requestId,/^[0-9a-f-]{36}$/);
   for(const locale of ['en','zh-CN']){
    await language(locale);await page.getByText(expected(locale),{exact:true}).waitFor();
    assert.deepEqual(await page.evaluate(()=>window.inspectProjectTaskFixture()),before);
    assert.deepEqual(await page.evaluate(()=>window.taskFailure),fixture.failure);
    assert.equal(await page.evaluate(()=>window.taskCalls.filter(call=>call.command==='run_project_action').length),count+1);
    if(frame)assert.equal(await frame.evaluate(node=>node.isConnected),true);
   }
   assert.deepEqual(before.actions[0].args,['原文 /{arg}']);
   if(!fixture.failure)assert.equal(before.runs[0].output,'命令输出原文 /{output}');
   assert.equal(await run().isEnabled(),true);
  }
  const hostMessage=(key,params={})=>({schema:'aibo.host-message/v1',key:'native.project.'+key,params});
  const segment=(prefix,raw,message)=>({start:Buffer.byteLength(prefix),end:Buffer.byteLength(prefix+raw),raw,message});
  const display=segments=>({schema:'aibo.project-output-display/v1',segments});
  const cancelled='\nExecution stopped after cancellation or loss of its record; earlier effects may remain. Inspect changes before another run.';
  const prefix='命令原文 😀 /{output}'+cancelled+'\n命令仍是原文';
  const rejected='Task was not started: approval denied. Submit a new request after checking the current context.';
  const unknown='Execution result unknown: 底层原文 /{error}';
  const truncated='\n… 工程动作输出已截断';
  const restartApproval='Host restarted during approval; task was not started.';
  const restartExecution='\nHost restarted before execution settled; inspect effects before retrying.';
  const outputs=[
   {status:'rejected',output:rejected,metadata:display([segment('',rejected,hostMessage('outputRejected',{decision:{schema:'aibo.host-message/v1',key:'native.writeRun.denied',params:{}}}))])},
   {status:'outcome_unknown',output:unknown,metadata:display([segment('',unknown,hostMessage('outputUnknown',{error:'底层原文 /{error}'}))])},
   {status:'outcome_unknown',output:prefix+cancelled,metadata:display([segment(prefix,cancelled,hostMessage('outputCancelled'))])},
   {status:'completed',output:prefix+truncated,metadata:display([segment(prefix,truncated,hostMessage('outputTruncated'))])},
   {status:'rejected',output:restartApproval,metadata:display([segment('',restartApproval,hostMessage('outputRestartApproval'))])},
   {status:'outcome_unknown',output:prefix+restartExecution,metadata:display([segment(prefix,restartExecution,hostMessage('outputRestartExecution'))])},
   {status:'outcome_unknown',output:prefix+cancelled+truncated,metadata:display([segment(prefix,cancelled,hostMessage('outputCancelled')),segment(prefix+cancelled,truncated,hostMessage('outputTruncated'))])},
   {status:'completed',output:prefix+cancelled,metadata:null},
   {status:'completed',output:prefix+cancelled,metadata:{schema:'invalid',segments:[]}},
   {status:'completed',output:prefix+cancelled,metadata:display([segment(prefix,cancelled,hostMessage('outputFuture'))])},
   {status:'completed',output:prefix+cancelled,metadata:display([{...segment(prefix,cancelled,hostMessage('outputCancelled')),raw:'changed'}])},
  ];
  outputs.push({...outputs[2],output:'\ufeff'+outputs[2].output+'\ufeff尾部原文',metadata:display(outputs[2].metadata.segments.map(segment=>({...segment,start:segment.start+3,end:segment.end+3})))});
  const expectedOutput=(fixture,locale)=>{
   const segments=fixture.metadata?.schema==='aibo.project-output-display/v1'?fixture.metadata.segments:null;
   if(!segments||!segments.length||segments.some(value=>value.message.key==='native.project.outputFuture'||value.raw==='changed'))return fixture.output;
   const bytes=Buffer.from(fixture.output);let end=0,output='';
   for(const value of segments){output+=bytes.subarray(end,value.start).toString()+translateMessage(locale,value.message);end=value.end;}
   return output+bytes.subarray(end).toString();
  };
  for(const fixture of outputs){
   await page.evaluate(fixture=>window.prepareProjectOutputFixture(fixture),fixture);await settle();
   await run().click();await settle();
   await page.waitForFunction(expected=>window.inspectProjectTaskPublicFixture()[0]?.output===expected,expectedOutput(fixture,'zh-CN'));
   assert.equal(await scope.locator('pre').last().textContent(),expectedOutput(fixture,'zh-CN'));
   const before=await page.evaluate(()=>window.inspectProjectTaskFixture());
   assert.equal(before.runs[0].output,fixture.output);assert.deepEqual(before.runs[0].localizedOutput,fixture.metadata);
   const calls=await page.evaluate(()=>window.taskCalls.filter(call=>['run_project_action','save_project_action','list_project_actions','list_project_action_runs'].includes(call.command)));
   for(const locale of ['en','zh-CN']){
    await language(locale);
    await page.waitForFunction(expected=>window.inspectProjectTaskPublicFixture()[0]?.output===expected,expectedOutput(fixture,locale));
    assert.equal(await scope.locator('pre').last().textContent(),expectedOutput(fixture,locale));
    assert.deepEqual(await page.evaluate(()=>window.inspectProjectTaskFixture()),before);
    assert.deepEqual(await page.evaluate(()=>window.taskOutputFixture),fixture);
    const publicRuns=await page.evaluate(()=>window.inspectProjectTaskPublicFixture());assert.equal(publicRuns.some(run=>Object.hasOwn(run,'localizedOutput')),false);
    assert.deepEqual(await page.evaluate(()=>window.taskCalls.filter(call=>['run_project_action','save_project_action','list_project_actions','list_project_action_runs'].includes(call.command))),calls);
    if(frame)assert.equal(await frame.evaluate(node=>node.isConnected),true);
   }
  }
  await scope.getByRole('button',{name:config.pkg?'编辑 任务原文 {name}':'编辑',exact:true}).click();await settle();
  await page.waitForFunction(()=>window.inspectProjectTaskFixture().editor?.open);
  const editorBefore=await page.evaluate(()=>window.inspectProjectTaskFixture());
  const writesBefore=await page.evaluate(()=>window.taskCalls.filter(call=>['run_project_action','save_project_action'].includes(call.command)));
  for(const locale of ['zh-CN','en','zh-CN']){
   await language(locale);
   const kinds=['test','lint','build','custom'].map(kind=>translateMessage(locale,{key:'external.'+kind,params:{}}));
   if(config.pkg){
    for(const label of kinds)await scope.getByRole('button',{name:label,exact:true}).waitFor();
    assert.equal(await scope.getByRole('button',{name:kinds[0],exact:true}).getAttribute('aria-pressed'),'true');
   }else{
    await scope.getByRole('combobox',{name:translateMessage(locale,{key:'project.kind',params:{}})}).click();
    for(const label of kinds)await page.getByRole('option',{name:label,exact:true}).waitFor();
    await page.keyboard.press('Escape');
   }
   assert.deepEqual(await page.evaluate(()=>window.inspectProjectTaskFixture()),editorBefore);
   assert.deepEqual(await page.evaluate(()=>window.taskCalls.filter(call=>['run_project_action','save_project_action'].includes(call.command))),writesBefore);
   if(frame)assert.equal(await frame.evaluate(node=>node.isConnected),true);
  }
  // The independent history panel remains host-owned even with an external inspector.
  const historyFixture=outputs.at(-1);
  await page.evaluate(fixture=>{window.taskRuns=[{...window.taskRuns[0],output:fixture.output,localizedOutput:fixture.metadata,status:fixture.status}];window.openProjectTaskHistoryFixture();},historyFixture);
  const history=page.locator('[data-ui-component="execution-history"]');await history.waitFor();
  await history.locator('summary').click();
  const historyOutput=history.getByRole('textbox');await historyOutput.waitFor();
  const historyBefore=await page.evaluate(()=>window.inspectProjectTaskHistoryFixture());
  const callsBefore=await page.evaluate(()=>window.taskCalls.filter(call=>['run_project_action','save_project_action','list_project_action_runs','list_workspace_write_runs'].includes(call.command)));
  for(const locale of ['zh-CN','en','zh-CN']){
   await language(locale);assert.equal(await historyOutput.inputValue(),expectedOutput(historyFixture,locale));
   assert.deepEqual(await page.evaluate(()=>window.inspectProjectTaskHistoryFixture()),historyBefore);
   assert.deepEqual(await page.evaluate(()=>window.taskCalls.filter(call=>['run_project_action','save_project_action','list_project_action_runs','list_workspace_write_runs'].includes(call.command))),callsBefore);
  }
  assert.deepEqual(errors,[]);await page.close();console.log(`${config.kit}/${config.theme}/${config.pkg?.release.manifest.id??'builtin'}: task errors, notices, kind menus and owned output fragments switch language in inspector and history, raw command text and canonical state preserved, no repeated reads or execution`);
 }
}finally{await browser.close();await server.close();await skins.dispose();}
