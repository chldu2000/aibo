import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {translateMessage} from '../packages/i18n/index.js';
import {buildPresentationSkins} from './lib/build-presentation-skins.mjs';

const skins=await buildPresentationSkins();
const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false,watch:null},plugins:[{
  name:'observe-writable-capability',enforce:'pre',transform(code,id){
    if(!id.endsWith('/src/App.svelte'))return;
    const marker='  const capabilityWorkbenchDirectory =';assert.ok(code.includes(marker));
    return code.replace(marker,`  if(typeof window!=='undefined')window.inspectWritableCapability=()=>JSON.parse(JSON.stringify({canonical:installedWorkbenchState,public:externalCapability,workspace:selectedWorkspaceId,session:selectedSessionId,actions:externalInput.data?.capabilityActions??[]}));\n${marker}`);
  },
}]});await server.listen();
const browser=await chromium.launch({headless:true});
try {
  const cases=['material3','ak-ui'].flatMap(kit=>['light','dark'].map(theme=>({kit,theme,pkg:null})));
  for(const pkg of skins.packages){assert.ok(pkg.release.manifest.snapshotSchemas.includes('aibo.semantic-view/v1.1'));cases.push({kit:'material3',theme:'light',pkg});}
  for(const config of cases){
    const page=await browser.newPage({viewport:{width:1280,height:900}});page.setDefaultTimeout(15000);
    const errors=[];page.on('pageerror',error=>errors.push(error.stack??error.message));
    await page.addInitScript(({kit,theme,pkg})=>{
      if(window!==window.top)return;
      localStorage.setItem('aibo.language.v1','zh-CN');localStorage.setItem('aibo.appearance.v1',JSON.stringify({kitId:kit,themeId:theme}));
      localStorage.setItem('aibo.selected-session',JSON.stringify({workspaceId:'w',sessionId:'source'}));
      let callback=0,revision=0,generation=0;window.writeCalls=[];
      const contribution={installationId:'installation',contributionId:'third.tool',title:'工具名称原文 {title}',scope:'workspace',available:true,issue:null};
      const snapshot=()=>({schema:'aibo.semantic-view/v1.1',context:{workspaceId:'w',contributionId:'third.tool',generation:'generation:'+generation,revision:++revision},contribution:{id:'third.tool',extensionPoint:'workspace.tool',title:contribution.title},state:{status:'ready',message:''},view:{kind:'detail',itemId:'item',properties:[{label:'提供者属性原文',value:'值 /{error}'}],content:'提供者正文原文 /{error}',truncated:false},actions:[{id:'refresh',label:'Refresh',intent:'refresh',enabled:true},{id:'example.write',label:'Write',intent:'execute',enabled:true,input:{value:'原始写入参数 /{value}'}}]});
      window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback(fn){const id=++callback;window['_'+id]=fn;return id;},unregisterCallback(id){delete window['_'+id];},async invoke(command,args={}){
        window.writeCalls.push({command,args});
        if(command.startsWith('plugin:event|'))return 1;
        if(command==='get_app_snapshot')return {platform:'macos',appVersion:'probe',workspaceCount:1,diagnostics:[]};
        if(command==='list_workspaces')return [{id:'w',path:'/probe',label:'工作区原文',trust:'trusted',createdAt:'now',updatedAt:'now'}];
        if(command==='list_sessions')return [{id:'source',workspaceId:'w',agent:'third.agent',pluginInstallationId:'pinned-release',label:'会话原文',state:'idle',archived:false,capabilities:[],createdAt:'now',updatedAt:'now'}];
        if(command==='get_timeline')return [{id:'raw',sessionId:'source',role:'assistant',content:'Agent 原文',toolName:null,status:'completed',createdAt:'now',updatedAt:'now'}];
        if(command==='get_composer_draft'||command==='get_turn_change_set')return null;
        if(command==='get_session_execution_profile')return {sessionId:'source',requested:{},enforced:{},unsupported:[],adapterCapabilities:[],sessionControls:[]};
        if(command==='get_workspace_changes')return {workspaceId:'w',dirty:false,files:[],captureStatus:'captured'};
        if(command==='list_workspace_git_repositories')return {repositories:[],limited:false,warnings:[]};
        if(command==='inspect_workspace_capabilities')return {workspaceId:'w',instructions:[],skills:[],tools:[],mcpServers:[],warnings:[]};
        if(command==='read_workspace_preferences')return {trustNewWorkspaces:true};
        if(command==='get_presentation_selection')return pkg?{digest:pkg.release.digest,themeId:null}:null;
        if(command==='list_presentation_packages')return pkg?[pkg.release]:[];
        if(command==='read_presentation_package')return pkg;
        if(command==='list_semantic_contributions')return [contribution];
        if(command==='open_semantic_contribution'){generation++;revision=0;return snapshot();}
        if(command==='act_semantic_contribution')return snapshot();
        if(command==='write_semantic_contribution'){if(window.writeFailure)throw window.writeFailure;return {ok:true};}
        if(command==='release_semantic_contribution'||command==='cancel_semantic_open')return;
        return [];
      }};
    },config);
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
    await page.waitForFunction(()=>typeof window.inspectWritableCapability==='function'&&window.writeCalls.some(call=>call.command==='list_semantic_contributions'));
    await page.keyboard.press('Control+k');await page.getByRole('combobox',{name:'全局搜索内容'}).fill('工具名称原文');
    await page.getByText('工具名称原文 {title}',{exact:true}).click();
    const surface=config.pkg?page.frameLocator('.presentation-external iframe:visible'):page;
    const write=()=>surface.getByRole('button',{name:'Write',exact:true});
    const refresh=()=>surface.getByRole('button',{name:'Refresh',exact:true});
    const assertWriteUnavailable=async()=>{
      const state=await page.evaluate(()=>window.inspectWritableCapability());
      assert.equal(state.canonical.snapshot.actions.find(action=>action.id==='example.write').enabled,false);
      assert.equal(state.actions.some(action=>action.operation==='semantic'&&JSON.parse(action.args[0]).actionId==='example.write'),false);
      if(await write().count())assert.equal(await write().isDisabled(),true);
    };
    await write().waitFor();
    const frame=config.pkg?await page.locator('.presentation-external iframe:visible').elementHandle():null;
    const settle=()=>config.pkg?page.waitForTimeout(250):Promise.resolve();
    const language=async locale=>{await page.evaluate(async locale=>{const {language}=await import('/src/lib/i18n/runtime.ts');language.set({preference:locale,locale});},locale);await settle();};
    const descriptor={schema:'aibo.host-message/v1',key:'native.broker.writeUnconfirmed',params:{code:'provider_raw {code}'}};
    const failure={code:'outcome_unknown',message:'原始结果诊断 /{error}',invocationId:'调用原文 /{id}',localized:descriptor};
    const preflightKeys=['workspaceChanged','workspaceDirectory','parentInactive','rootDirectoryChanged','callerChainChanged','callerIntegrity','callerPackageChanged','providerChanged','packageIntegrity','packageChanged','dependenciesChanged','dependenciesUnavailable','sessionUnavailable','cancelledBeforeDispatch'];
    const preflightFailures=preflightKeys.flatMap(key=>{
      const reason={schema:'aibo.host-message/v1',key:'native.capabilityWrite.'+key,params:{}};
      return [{...failure,code:key==='cancelledBeforeDispatch'?'cancelled':'invalid_input',localized:reason},
        {...failure,localized:{schema:'aibo.host-message/v1',key:'native.error.writeOutcomeUnknown',params:{error:reason}}}];
    });
    const writeRunReason=(key,params={})=>({schema:'aibo.host-message/v1',key:'native.writeRun.'+key,params});
    const writeRunFailures=[
      ...['requestConflict','permissionScope','invalidRequestId','liveLease','approvalSummaryLimit','intentLimit','gitWorkspaceChanged','gitSessionUnavailable','gitTurnUnavailable'].map(key=>({...failure,code:'invalid_input',localized:writeRunReason(key)})),
      ...['storedErrorCode','storedErrorMessage','admissionMissing','storedResultIncompatible'].map(key=>({...failure,code:'initialization_error',localized:writeRunReason(key,{error:'底层解析原文 /{error}'})})),
      ...['noStoredResult','serializationFailed','persistenceFailed','settlementChanged'].map(key=>({...failure,localized:{schema:'aibo.host-message/v1',key:'native.error.writeOutcomeUnknown',params:{error:writeRunReason(key,{id:'写入标识原文 /{id}',error:'底层结算原文 /{error}'})}}})),
      {...failure,code:'approval_rejected',localized:writeRunReason('restartApproval')},
      {...failure,localized:writeRunReason('restartSettlement')},
      ...['denied','stale','cancelled','unavailable','expired'].map(decision=>({...failure,code:'approval_rejected',localized:writeRunReason('approvalRejected',{decision:writeRunReason(decision)})})),
    ];
    for(const error of [failure,{...failure,localized:undefined},{...failure,localized:{...descriptor,key:'native.broker.unknown'}},{...failure,localized:{...descriptor,schema:'invalid'}},...preflightFailures,...writeRunFailures]){
      await page.evaluate(error=>window.writeFailure=error,error);
      const writes=await page.evaluate(()=>window.writeCalls.filter(call=>call.command==='write_semantic_contribution').length);
      await write().click();await settle();
      const known=error.localized?.schema==='aibo.host-message/v1'&&error.localized.key!=='native.broker.unknown';
      const expected=locale=>translateMessage(locale,error.code==='approval_rejected'?{key:'installed.writeRejected',params:{}}:error.code==='outcome_unknown'?(known?{key:'installed.writeUnknownDetail',params:{error:error.localized}}:{key:'installed.writeUnknown',params:{}}):error.localized);
      await surface.getByText(expected('zh-CN'),{exact:true}).waitFor();
      await assertWriteUnavailable();assert.equal(await refresh().isEnabled(),true);
      const before=await page.evaluate(()=>window.inspectWritableCapability()),calls=await page.evaluate(()=>window.writeCalls),raw=structuredClone(error);
      assert.equal(before.canonical.snapshot.schema,'aibo.semantic-view/v1.1');assert.equal(before.canonical.snapshot.view.content,'提供者正文原文 /{error}');
      assert.equal(before.workspace,'w');assert.equal(before.session,'source');
      const request=calls.filter(call=>call.command==='write_semantic_contribution').at(-1).args;
      assert.match(request.requestId,/^[0-9a-f-]{36}$/);assert.equal(request.action.actionId,'example.write');assert.equal(request.action.context.workspaceId,'w');assert.equal(request.action.context.contributionId,'third.tool');
      for(const locale of ['en','zh-CN']){
        await language(locale);await surface.getByText(expected(locale),{exact:true}).waitFor();
        const after=await page.evaluate(()=>window.inspectWritableCapability());
        assert.deepEqual(after.canonical,before.canonical);assert.equal(after.public.view.error,expected(locale));
        assert.equal(JSON.stringify(after.public).includes('aibo.host-message/v1'),false);
        assert.deepEqual(await page.evaluate(()=>window.writeCalls.filter(call=>['write_semantic_contribution','act_semantic_contribution','open_semantic_contribution','get_timeline'].includes(call.command))),calls.filter(call=>['write_semantic_contribution','act_semantic_contribution','open_semantic_contribution','get_timeline'].includes(call.command)));
        assert.deepEqual(await page.evaluate(()=>window.writeFailure),raw);
        await assertWriteUnavailable();assert.equal(await refresh().isEnabled(),true);
        if(frame)assert.equal(await frame.evaluate(node=>node.isConnected),true);
      }
      assert.equal(await page.evaluate(()=>window.writeCalls.filter(call=>call.command==='write_semantic_contribution').length),writes+1);
      await page.evaluate(()=>window.writeFailure=null);await refresh().click();await settle();
      await page.waitForFunction(()=>window.inspectWritableCapability().canonical.error==='');assert.equal(await write().isEnabled(),true);
    }
    const writes=await page.evaluate(()=>window.writeCalls.filter(call=>call.command==='write_semantic_contribution').length);
    await write().click();await settle();await page.waitForFunction(()=>window.inspectWritableCapability().canonical.error===''&&window.inspectWritableCapability().canonical.snapshot.state.status==='ready');
    assert.equal(await page.evaluate(()=>window.writeCalls.filter(call=>call.command==='write_semantic_contribution').length),writes+1);
    assert.equal(await write().isEnabled(),true);assert.deepEqual(errors,[]);
    console.log(`${config.kit}/${config.theme}/${config.pkg?.release.manifest.id??'builtin'}: writable v1.1, unknown-result safety and localized detail, invalid metadata fallback, stable state and instance, explicit refresh and successful write passed`);
    await page.close();
  }
} catch(error){await writeFile('/tmp/aibo-i18n-capability-write-failure-126.txt',String(error));throw error;}
finally{await browser.close();await server.close();await skins.dispose();}
