import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {translateMessage} from '../packages/i18n/index.js';
import {buildPresentationSkins} from './lib/build-presentation-skins.mjs';

const skins=await buildPresentationSkins();
const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false,watch:null},plugins:[{
  name:'session-start-i18n-observation',enforce:'pre',transform(code,id){
    if(!id.endsWith('/src/App.svelte'))return;
    const marker='  const sessionStartupController =';
    assert.ok(code.includes(marker));
    return code.replace(marker,`  if(typeof window!=='undefined')Object.assign(window,{
      startSessionFixture(stage,key,params={}){window.sessionFailure={stage,key,params};activateWorkspace('w');return createPluginSession('pinned-release','third.agent','w');},
      async runLifecycleFixture(operation,key){
        window.lifecycleFailure={operation,key};activateWorkspace('w');selectSession('source');
        if(operation==='fork')await forkSession('source');
        if(operation==='close')await sessionLifecycle.closeSession('source');
        if(operation==='stop')await messageController.abortPrompt();
        if(operation==='archive'){requestArchiveSession('source');await confirmArchiveSession();}
      },
      async runSendFixture(key){window.sendFailure=key;activateWorkspace('w');selectSession('source');await tick();composerText='发送草稿原文 {error}';await messageController.sendPrompt();},
      inspectSendFixture(){return {draft:composerText,promptInFlight,busy,error:errorMessage,session:findSession('source'),selected:selectedSessionId};},
      showApprovalFixture(key){window.approvalFailure=key;activateWorkspace('w');selectSession('source');errorMessage=null;pendingApprovals=[{requestId:'审批ID {request}',sessionId:'source',turnId:'turn原文',kind:'command',command:'echo 命令原文 {command}',cwd:'/原文/{cwd}',availableDecisions:[],options:[{id:'选项ID {id}',kind:'allow',label:'批准原文 {option}'}]}];},
      inspectApprovalFixture(){return {pending:pendingApprovals,error:errorMessage,busy,selected:selectedSessionId,session:findSession('source')};},
      async prepareModelFixture(){activateWorkspace('w');selectSession('source');updateWorkspaceSessions('w',items=>items.map(item=>item.id==='source'?{...item,capabilities:[...item.capabilities,'model.select']}:item));await tick();await loadSessionModels();},
      async runModelFixture(key){window.modelFailure=key;sessionModelCatalogs.invalidate('source');await loadSessionModels();},
      async runModelGuardFixture(change,capabilities,bound){window.modelFailure=null;activateWorkspace('w');selectSession('source');updateWorkspaceSessions('w',items=>items.map(item=>item.id==='source'?{...item,capabilities,pluginInstallationId:bound?'pinned-release':null}:item));await tick();await applyModelChange(change);},
      inspectModelFixture(){return {catalog:sessionModelCatalog,selected:selectedSessionId,session:findSession('source'),error:errorMessage,loading:sessionModelCatalogLoading};},
      inspectSessionFixture(){return {selected:selectedSessionId,session:findSession('created'),source:findSession('source'),error:errorMessage};},
      inspectLifecycleTimeline(){return {timeline,external:externalInput.data?.conversation??null,presentationError:presentationPackages.error};}
    });
${marker}`);
  }
}]});
await server.listen();
const browser=await chromium.launch({headless:true});
try{
  const cases=['material3','ak-ui'].flatMap(kit=>['light','dark'].map(theme=>({kit,theme,pkg:null})));
  for(const pkg of skins.packages)cases.push({kit:'material3',theme:'light',pkg});
  for(const config of cases.filter(config=>!process.env.AIBO_PROBE_EXTERNAL_ONLY||config.pkg)){
    const page=await browser.newPage({viewport:{width:1280,height:900}});page.setDefaultTimeout(15000);
    const errors=[];page.on('pageerror',error=>errors.push(error.stack??error.message));
    await page.addInitScript(({kit,theme,pkg})=>{
      if(window!==window.top)return;
      localStorage.setItem('aibo.language.v1','zh-CN');localStorage.setItem('aibo.appearance.v1',JSON.stringify({kitId:kit,themeId:theme}));
      const workspace={id:'w',path:'/probe',label:'工作区原文 {label}',trust:'trusted',createdAt:'now',updatedAt:'now'};
      const source={id:'source',workspaceId:'w',agent:'third.agent',pluginInstallationId:'pinned-release',label:'来源原文 {label}',state:'idle',archived:false,capabilities:['session.fork'],createdAt:'now',updatedAt:'now'};
      window.sessionFixture={...source,id:'created',label:'会话原文 {label}',state:'starting'};
      const model={id:'模型ID {id}',reference:'提供者/模型ID {id}',provider:'提供者原文',label:'模型原文 {name}',description:'模型说明原文',isDefault:true,defaultReasoningEffort:null,reasoningEfforts:[],serviceTiers:[],contextWindows:[]};
      window.modelFixture={parameterScope:'all-models',current:model,models:[model],currentReasoningEffort:null,reasoningEfforts:[],currentServiceTier:null,currentContextWindow:null};
      window.sessionCalls=[];let created=false,callback=0;
      window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback(fn){const id=++callback;window['_'+id]=fn;return id;},unregisterCallback(id){delete window['_'+id];},async invoke(command,args={}){
        window.sessionCalls.push({command,args});
        if(command.startsWith('plugin:event|'))return 1;
        if(command==='get_app_snapshot')return {platform:'macos',appVersion:'probe',workspaceCount:1,diagnostics:[]};
        if(command==='list_workspaces')return [workspace];
        if(command==='list_sessions')return [source,...(created?[{...window.sessionFixture}]:[])];
        if(command==='create_agent_session'||command==='resume_agent_session'){
          const failure=window.sessionFailure;
          if(failure?.stage===(command==='create_agent_session'?'prepare':'resume')){
            const message='third-party 原始诊断 {error}';
            if(failure.key==='raw')throw Error(message);
            throw {message,localized:{schema:failure.key==='invalid'?'unknown':'aibo.host-message/v1',key:failure.key,params:failure.params}};
          }
          created=true;return {...window.sessionFixture,state:command==='resume_agent_session'?'idle':'starting'};
        }
        if(['fork_codex_thread','close_agent_session','cancel_agent_turn','archive_session'].includes(command)){
          const failure=window.lifecycleFailure;
          if(failure?.key){
            const message='third-party 生命周期诊断 {error}';
            if(failure.key==='raw')throw Error(message);
            throw {code:'session_operation_error',message,localized:{schema:failure.key==='invalid'?'unknown':'aibo.host-message/v1',key:failure.key,params:{}}};
          }
          return;
        }
        if(command==='get_session_models'){
          const key=window.modelFailure;
          if(key){const message='模型目录原始诊断 {error}';if(key==='raw')throw Error(message);throw {code:'session_operation_error',message,localized:{schema:key==='invalid'?'invalid':'aibo.host-message/v1',key,params:{}}};}
          return window.modelFixture;
        }
        if(command==='resolve_agent_approval'){
          const key=window.approvalFailure;
          if(key){const message='审批原始诊断 {error}';if(key==='raw')throw Error(message);throw {code:'session_operation_error',message,localized:{schema:key==='invalid'?'invalid':'aibo.host-message/v1',key,params:{}}};}
          return;
        }
        if(command==='send_agent_prompt'){
          const key=window.sendFailure;
          if(key){const message='发送准入诊断原文 {error}';if(key==='raw')throw Error(message);throw {message,localized:{schema:key==='invalid'?'invalid':'aibo.host-message/v1',key,params:{}}};}
          return source;
        }
        if(command==='get_presentation_selection')return pkg?{digest:pkg.release.digest,themeId:null}:null;
        if(command==='list_presentation_packages')return pkg?[pkg.release]:[];
        if(command==='read_presentation_package')return pkg;
        if(command==='get_timeline')return [{id:'raw',sessionId:args.sessionId,role:'assistant',toolName:null,content:'Agent 正文原文 {error}',status:'completed',createdAt:'now',updatedAt:'now'}];
        if(command==='get_composer_draft'||command==='get_turn_change_set')return null;
        if(command==='get_session_execution_profile')return {sessionId:args.sessionId,requested:{},enforced:{},unsupported:[],adapterCapabilities:[],sessionControls:[]};
        if(command==='get_workspace_changes')return {workspaceId:'w',dirty:false,files:[],captureStatus:'captured'};
        if(command==='list_workspace_git_repositories')return {repositories:[],limited:false,warnings:[]};
        if(command==='inspect_workspace_capabilities')return {workspaceId:'w',instructions:[],skills:[],tools:[],mcpServers:[],warnings:[]};
        if(command==='read_workspace_preferences')return {trustNewWorkspaces:true};
        return [];
      }};
    },config);
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
    await page.waitForFunction(()=>typeof window.startSessionFixture==='function'&&window.sessionCalls.some(call=>call.command==='list_workspaces'));
    if(config.pkg){
      const frame=page.locator('.presentation-external iframe:visible');await frame.waitFor();
      await frame.evaluate(node=>node.dataset.probeIdentity='same-instance');
    }
    const scenarios=[
      ...['prepareTrust','installationUnavailable','contributionMissing','noEnabledInstallation'].map(key=>['prepare','native.session.'+key]),
      ['prepare','native.profile.choice',{field:'interactionMode',value:'原始值 /{value}'}],
      ['prepare','native.profile.schema',{schema:'原始格式 /{schema}'}],
      ...['storedRequested','storedEnforced','storedUnsupported','storedCapabilities','storedBackend'].flatMap(key=>[
        ['prepare','native.profile.'+key,{error:'底层解析原文 /{error}'}],
        ['resume','native.error.invalidExecutionProfile',{error:{key:'native.profile.'+key,params:{error:'底层解析原文 /{error}'}}}],
      ]),
      ['prepare','native.profile.agentManaged'],
      ...['profile','nativeEnforcement','authority','unavailable','initialMode'].map(key=>['prepare','native.controls.'+key]),
      ['resume','native.error.invalidExecutionProfile',{error:{key:'native.profile.choice',params:{field:'approvalReviewer',value:'原始值 /{value}'}}}],
      ...['native.controls.historyOnly','native.controls.archived','native.session.userInputHistoryOnly','native.tree.historyOnly','native.tree.navigationHistoryOnly'].map(key=>['resume',key]),
      ['prepare','native.manifest.schemaValidation'],
      ...['retiredData','newCapabilitySession','pinnedUnavailable','retiredRuntime','closed','oldBinding'].map(key=>['resume','native.session.'+key]),
      ['resume','native.manifest.schemaValidation'],
      ...['raw','invalid','native.session.unknown'].map(key=>['resume',key]),
      ['prepare','native.error.workspaceNotFound',{id:'工作区 /{id}'}],
      ['resume','native.error.sessionNotFound',{id:'会话 /{id}'}],
      ['prepare','native.error.invalidSessionFilter',{filter:'未知筛选 {filter}'}],
      ...['invalidWorkspacePath','invalidSessionLabel','invalidExecutionProfile','agentProbe','initialization'].map(key=>['resume','native.error.'+key,{error:'provider 原始诊断 /{error}'}]),
      ...['labelEmpty','labelTooLong'].map(key=>['prepare','native.error.'+key]),
      ...['storage','workspaceTrust','contractVersion','pinnedInstallation','inputContract','scopeBusy','taskStopped'].map(key=>['resume','native.broker.'+key]),
      ['resume','native.broker.writeUnconfirmed',{code:'provider_raw {code}'}],
      ...['cancelled','deadline','nodeUnavailable','processStart','invalidResult','versionDeclaration','executableUnavailable','dependencyCycle'].map(key=>['resume','native.broker.'+key]),
      ...['interactiveCaller','controlContract','candidateSelection','streamOrder'].map(key=>['resume','native.broker.'+key]),
    ];
    // Keep the exhaustive fixture below the sandbox's 120 worker messages/second gate.
    // Each case still asserts the same instance, reads, state and execution counts.
    const settle=()=>config.pkg?page.waitForTimeout(250):Promise.resolve();
    const language=async locale=>{await page.evaluate(async locale=>{const {language}=await import('/src/lib/i18n/runtime.ts');language.set({preference:locale,locale});},locale);await settle();};
    for(const [stage,key,params={}] of scenarios){
      await page.evaluate(({stage,key,params})=>window.startSessionFixture(stage,key,params),{stage,key,params});await settle();
      const known=key!=='raw'&&key!=='invalid'&&key!=='native.session.unknown';
      const expected=locale=>{
        const error=known?{key,params}:'third-party 原始诊断 {error}';
        return translateMessage(locale,stage==='resume'?{key:'startup.failed',params:{error}}:error);
      };
      await page.getByRole('alert').filter({hasText:expected('zh-CN')}).first().waitFor();
      const snapshot=await page.evaluate(()=>window.inspectSessionFixture());
      const calls=await page.evaluate(()=>window.sessionCalls.filter(call=>['create_agent_session','resume_agent_session'].includes(call.command)));
      const timelineReads=await page.evaluate(()=>window.sessionCalls.filter(call=>call.command==='get_timeline').length);
      const prepare=calls.filter(call=>call.command==='create_agent_session').at(-1);
      assert.deepEqual(prepare.args,{workspaceId:'w',agentId:'third.agent',installationId:'pinned-release',requestedProfile:null,deferStart:true});
      if(stage==='resume'){
        assert.deepEqual(calls.at(-1),{command:'resume_agent_session',args:{sessionId:'created'}});
        assert.equal(snapshot.session.state,'failed');assert.equal(snapshot.session.pluginInstallationId,'pinned-release');
        assert.equal(snapshot.session.label,'会话原文 {label}');
      }
      for(const locale of ['en','zh-CN']){
        await language(locale);await page.getByRole('alert').filter({hasText:expected(locale)}).first().waitFor();
        assert.deepEqual(await page.evaluate(()=>window.inspectSessionFixture()),snapshot);
        assert.deepEqual(await page.evaluate(()=>window.sessionCalls.filter(call=>['create_agent_session','resume_agent_session'].includes(call.command))),calls);
        assert.equal(await page.evaluate(()=>window.sessionCalls.filter(call=>call.command==='get_timeline').length),timelineReads);
        if(config.pkg)assert.equal(await page.locator('.presentation-external iframe:visible').getAttribute('data-probe-identity'),'same-instance');
      }
    }
    await page.evaluate(()=>window.startSessionFixture(null,null));
    await page.waitForFunction(()=>window.inspectSessionFixture().session.state==='idle'&&window.inspectSessionFixture().error===null);
    await page.evaluate(()=>window.runLifecycleFixture('select',null));
    const view=config.pkg?page.frameLocator('.presentation-external iframe:visible'):page;
    try{await view.getByText('Agent 正文原文 {error}',{exact:true}).waitFor();}catch(error){
      await writeFile('/tmp/aibo-i18n-lifecycle-browser-failure-119.json',JSON.stringify({config:config.pkg?.release.manifest.id??config.kit,state:await page.evaluate(()=>window.inspectSessionFixture()),timeline:await page.evaluate(()=>window.inspectLifecycleTimeline()),calls:await page.evaluate(()=>window.sessionCalls),frames:await Promise.all(page.frames().map(frame=>frame.locator('body').innerText()))},null,2));
      throw error;
    }
    const operations=[
      ...['branchIdle','branchArchived','branchBindingMissing','branchBoundary','branchNoBoundary','branchNativeIdentity','branchOutputIdentity','branchReusedIdentity','branchRecovery','branchProfileMissing','pinnedUnavailable','oldBinding'].map(key=>['fork','native.session.'+key]),
      ...['otherWindow','newCapabilitySession'].map(key=>['stop','native.session.'+key]),
      ...['otherWindow','newCapabilitySession','stillStopping'].map(key=>['close','native.session.'+key]),
      ...['activeInvocation','stillStopping'].map(key=>['archive','native.session.'+key]),
      ...['raw','invalid','native.session.unknown'].map(key=>['fork',key]),
    ];
    const commands={fork:'fork_codex_thread',stop:'cancel_agent_turn',close:'close_agent_session',archive:'archive_session'};
    for(const [operation,key] of operations){
      await page.evaluate(({operation,key})=>window.runLifecycleFixture(operation,key),{operation,key});await settle();
      const known=key!=='raw'&&key!=='invalid'&&key!=='native.session.unknown';
      const expected=locale=>translateMessage(locale,known?{key,params:{}}:'third-party 生命周期诊断 {error}');
      await page.getByRole('alert').filter({hasText:expected('zh-CN')}).first().waitFor();
      const snapshot=await page.evaluate(()=>window.inspectSessionFixture());
      assert.equal(snapshot.selected,'source');assert.equal(snapshot.source.state,'idle');assert.equal(snapshot.source.archived,false);
      assert.equal(snapshot.source.label,'来源原文 {label}');assert.equal(snapshot.source.pluginInstallationId,'pinned-release');
      const calls=await page.evaluate(()=>window.sessionCalls.filter(call=>['fork_codex_thread','close_agent_session','cancel_agent_turn','archive_session'].includes(call.command)));
      assert.deepEqual(calls.at(-1),{command:commands[operation],args:operation==='fork'?{sessionId:'source',throughTurnId:null}:{sessionId:'source'}});
      const reads=await page.evaluate(()=>window.sessionCalls.filter(call=>call.command==='get_timeline').length);
      for(const locale of ['en','zh-CN']){
        await language(locale);await page.getByRole('alert').filter({hasText:expected(locale)}).first().waitFor();
        await view.getByText('Agent 正文原文 {error}',{exact:true}).waitFor();
        assert.deepEqual(await page.evaluate(()=>window.inspectSessionFixture()),snapshot);
        assert.deepEqual(await page.evaluate(()=>window.sessionCalls.filter(call=>['fork_codex_thread','close_agent_session','cancel_agent_turn','archive_session'].includes(call.command))),calls);
        assert.equal(await page.evaluate(()=>window.sessionCalls.filter(call=>call.command==='get_timeline').length),reads);
        if(config.pkg)assert.equal(await page.locator('.presentation-external iframe:visible').getAttribute('data-probe-identity'),'same-instance');
      }
    }
    for(const key of ['native.permissions.workspaceTrust','native.permissions.installationDisabled','native.permissions.historyOnly','raw','invalid','native.permissions.unknown']){
      await page.evaluate(key=>window.runSendFixture(key),key);await settle();
      const known=key.startsWith('native.permissions.')&&key!=='native.permissions.unknown';
      const expected=locale=>translateMessage(locale,known?{key,params:{}}:'发送准入诊断原文 {error}');
      await page.getByRole('alert').filter({hasText:expected('zh-CN')}).first().waitFor();
      const original=await page.evaluate(()=>window.inspectSendFixture());
      assert.equal(original.draft,'发送草稿原文 {error}');assert.equal(original.selected,'source');assert.equal(original.session.state,'idle');
      assert.equal(original.promptInFlight,false);assert.equal(original.busy,false);
      const calls=await page.evaluate(()=>window.sessionCalls.filter(call=>call.command==='send_agent_prompt'));
      assert.deepEqual(calls.at(-1),{command:'send_agent_prompt',args:{sessionId:'source',input:'发送草稿原文 {error}'}});
      const reads=await page.evaluate(()=>window.sessionCalls.filter(call=>call.command==='get_timeline').length);
      for(const locale of ['en','zh-CN']){
        await language(locale);await page.getByRole('alert').filter({hasText:expected(locale)}).first().waitFor();
        assert.deepEqual(await page.evaluate(()=>window.inspectSendFixture()),original);
        assert.deepEqual(await page.evaluate(()=>window.sessionCalls.filter(call=>call.command==='send_agent_prompt')),calls);
        assert.equal(await page.evaluate(()=>window.sessionCalls.filter(call=>call.command==='get_timeline').length),reads);
        if(config.pkg)assert.equal(await page.locator('.presentation-external iframe:visible').getAttribute('data-probe-identity'),'same-instance');
      }
    }
    await page.evaluate(()=>window.runSendFixture(null));await settle();
    await page.waitForFunction(()=>window.inspectSendFixture().draft===''&&window.inspectSendFixture().error===null);
    for(const key of [
      ...['coreDecision','invalidOption','missingTurn','turnFinished','otherWindow','differentTurn','archived','invalidBinding','decision','notPending','sessionMismatch','workspaceTrust','answerShape','historyOnly'].map(key=>'native.approval.'+key),
      ...["schema", "generation", "binding", "lifecycle", "hostControl", "negotiation", "capability", "turn", "recoveryTurn", "recoveryData", "recoveryUpdate", "backgroundRoot", "backgroundOwner", "backgroundId", "backgroundChanged", "childRoot", "childOwner", "childId", "childMessage", "inactiveTurn", "failureStatus", "message", "reasoningId", "toolId", "toolType", "request", "terminalStatus"].map(key=>'native.event.'+key),
      'native.controls.transition','raw','invalid','native.approval.unknown',
    ]){
      await page.evaluate(key=>window.showApprovalFixture(key),key);await settle();
      await view.getByRole('button',{name:'批准原文 {option}',exact:true}).click();await settle();
      const known=!['raw','invalid','native.approval.unknown'].includes(key);
      const expected=locale=>translateMessage(locale,known?{key,params:{}}:'审批原始诊断 {error}');
      try{await page.getByRole('alert').filter({hasText:expected('zh-CN')}).first().waitFor();}catch(error){
        await writeFile('/tmp/aibo-i18n-approval-failure-153.json',JSON.stringify({config:config.pkg?.release.manifest.id??config.kit,key,state:await page.evaluate(()=>window.inspectApprovalFixture()),calls:await page.evaluate(()=>window.sessionCalls.slice(-25)),errors,frames:await Promise.all(page.frames().map(frame=>frame.locator('body').innerText()))},null,2));
        throw error;
      }
      const original=await page.evaluate(()=>window.inspectApprovalFixture());
      assert.equal(original.pending.length,1);assert.equal(original.busy,false);assert.equal(original.selected,'source');
      assert.equal(original.pending[0].requestId,'审批ID {request}');assert.equal(original.pending[0].options[0].id,'选项ID {id}');
      const calls=await page.evaluate(()=>window.sessionCalls.filter(call=>call.command==='resolve_agent_approval'));
      assert.deepEqual(calls.at(-1),{command:'resolve_agent_approval',args:{sessionId:'source',requestId:'审批ID {request}',optionId:'选项ID {id}'}});
      const reads=await page.evaluate(()=>window.sessionCalls.filter(call=>call.command==='get_timeline').length);
      for(const locale of ['en','zh-CN']){
        await language(locale);await page.getByRole('alert').filter({hasText:expected(locale)}).first().waitFor();
        assert.deepEqual(await page.evaluate(()=>window.inspectApprovalFixture()),original);
        assert.deepEqual(await page.evaluate(()=>window.sessionCalls.filter(call=>call.command==='resolve_agent_approval')),calls);
        assert.equal(await page.evaluate(()=>window.sessionCalls.filter(call=>call.command==='get_timeline').length),reads);
        if(config.pkg)assert.equal(await page.locator('.presentation-external iframe:visible').getAttribute('data-probe-identity'),'same-instance');
      }
    }
    await page.evaluate(()=>window.showApprovalFixture(null));await settle();
    await view.getByRole('button',{name:'批准原文 {option}',exact:true}).click();await settle();
    await page.waitForFunction(()=>window.inspectApprovalFixture().pending.length===0&&window.inspectApprovalFixture().error===null);
    await page.evaluate(()=>window.prepareModelFixture());await settle();
    const model=await page.evaluate(()=>window.modelFixture);
    await view.getByText('模型原文 {name}',{exact:true}).first().waitFor();
    for(const key of ['native.models.historyOnly','native.models.parameterScope','native.models.missingModels','raw','invalid','native.models.unknown']){
      await page.evaluate(key=>window.runModelFixture(key),key);await settle();
      const known=!['raw','invalid','native.models.unknown'].includes(key);
      const expected=locale=>translateMessage(locale,known?{key,params:{}}:'模型目录原始诊断 {error}');
      await page.getByRole('alert').filter({hasText:expected('zh-CN')}).first().waitFor();
      const original=await page.evaluate(()=>window.inspectModelFixture());
      assert.equal(original.selected,'source');assert.equal(original.loading,false);assert.deepEqual(original.catalog,model);
      const reads=await page.evaluate(()=>window.sessionCalls.filter(call=>['get_session_models','get_timeline'].includes(call.command)));
      for(const locale of ['en','zh-CN']){
        await language(locale);await page.getByRole('alert').filter({hasText:expected(locale)}).first().waitFor();
        await view.getByText('模型原文 {name}',{exact:true}).first().waitFor();
        assert.deepEqual(await page.evaluate(()=>window.inspectModelFixture()),original);
        assert.deepEqual(await page.evaluate(()=>window.sessionCalls.filter(call=>['get_session_models','get_timeline'].includes(call.command))),reads);
        if(config.pkg)assert.equal(await page.locator('.presentation-external iframe:visible').getAttribute('data-probe-identity'),'same-instance');
      }
    }
    await page.evaluate(()=>window.runModelFixture(null));await settle();
    await page.waitForFunction(()=>window.inspectModelFixture().error===null&&!window.inspectModelFixture().loading);
    assert.deepEqual(await page.evaluate(()=>window.inspectModelFixture().catalog),model);
    for(const [change,capabilities,bound,key,params] of [
      [{kind:'model',model:model.current.reference},['model.select'],false,'native.controls.historyOnly',{}],
      [{kind:'model',model:model.current.reference},[],true,'native.session.unsupportedCapability',{capability:'model.select'}],
      [{kind:'configuration',model:model.current.reference,reasoningEffort:'high'},['model.select'],true,'native.session.unsupportedCapability',{capability:'model.reasoning'}],
      [{kind:'serviceTier',serviceTier:'priority'},['model.select'],true,'native.session.unsupportedCapability',{capability:'model.service-tier'}],
      [{kind:'contextWindow',contextWindow:'原始窗口 {id}',modelReference:model.current.reference},['model.select'],true,'native.session.unsupportedCapability',{capability:'model.context-window'}],
    ]){
      const mutationsBefore=await page.evaluate(()=>window.sessionCalls.filter(call=>call.command==='invoke_agent_capability'));
      await page.evaluate(({change,capabilities,bound})=>window.runModelGuardFixture(change,capabilities,bound),{change,capabilities,bound});await settle();
      await page.getByRole('alert').filter({hasText:translateMessage('zh-CN',{key,params})}).first().waitFor();
      const original=await page.evaluate(()=>window.inspectModelFixture());assert.equal(original.selected,'source');assert.equal(original.loading,false);assert.deepEqual(original.catalog,model);
      const reads=await page.evaluate(()=>window.sessionCalls.filter(call=>['get_session_models','get_timeline'].includes(call.command)));
      assert.deepEqual(await page.evaluate(()=>window.sessionCalls.filter(call=>call.command==='invoke_agent_capability')),mutationsBefore);
      for(const locale of ['en','zh-CN']){
        await language(locale);await page.getByRole('alert').filter({hasText:translateMessage(locale,{key,params})}).first().waitFor();
        assert.deepEqual(await page.evaluate(()=>window.inspectModelFixture()),original);
        assert.deepEqual(await page.evaluate(()=>window.sessionCalls.filter(call=>['get_session_models','get_timeline'].includes(call.command))),reads);
        assert.deepEqual(await page.evaluate(()=>window.sessionCalls.filter(call=>call.command==='invoke_agent_capability')),mutationsBefore);
        if(config.pkg)assert.equal(await page.locator('.presentation-external iframe:visible').getAttribute('data-probe-identity'),'same-instance');
      }
    }
    await page.evaluate(()=>window.runLifecycleFixture('stop',null));
    await page.waitForFunction(()=>window.inspectSessionFixture().source.state==='interrupted'&&window.inspectSessionFixture().error===null);
    assert.deepEqual(errors,[]);await page.close();
    console.log(`${config.kit}/${config.theme}/${config.pkg?.release.manifest.id??'builtin'}: startup, fork, stop, close and archive errors translate with unchanged identity, execution counts and successful retry`);
  }
}finally{await browser.close();await server.close();await skins.dispose();}
