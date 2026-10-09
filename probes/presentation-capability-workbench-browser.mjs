import assert from 'node:assert/strict';
import {translateMessage,catalogs} from '../packages/i18n/index.js';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const source="self.aiboPresentation={render(input){const c=input.data?.capability??{view:{snapshot:null}};if(c.view.snapshot&&c.view.snapshot.schema!=='aibo.semantic-view/v1')throw Error('undeclared snapshot leaked');return {tag:'main',key:'main',children:[{tag:'h1',key:'heading',text:'External capability workbench'},{tag:'pre',key:'snapshot',attrs:{'aria-label':'Capability state'},text:JSON.stringify(c)},...(input.data?.capabilityActions??[]).map(a=>{const semantic=a.operation==='semantic'?JSON.parse(a.args[0]):null;return {tag:'button',key:a.token,text:semantic?'semantic:'+semantic.actionId+':'+(semantic.itemId||''):a.operation+(a.args.length?':'+a.args.join(':'):''),events:{click:a.token}}})]}}};";
const bytes=Buffer.from(source);
const pkg={release:{digest:'a'.repeat(64),enabled:true,manifest:{schema:'aibo.presentation-package/v1',id:'dev.example.workbench',version:'1.0.0',displayName:'External skin',hostApi:'1.0.0',coreSemantics:'1.0.0',snapshotSchemas:['aibo.semantic-view/v1'],entry:'skin.js',surfaces:['workbench'],resources:[{path:'skin.js',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),mediaType:'text/javascript'}]}},resources:{'skin.js':bytes.toString('base64')}};
const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false,watch:null}});await server.listen();
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];
page.on('pageerror',error=>errors.push(error.stack??error.message));page.setDefaultTimeout(10000);
try {
  await page.addInitScript(pkg=>{
    let callback=0;window.presentationCommands=[];window.presentationInstallable=pkg;
    const workspaces = ['w1','w2'].map(id=>({id,label:id,path:'/probe/'+id,trust:'trusted',createdAt:'2026-09-13',updatedAt:'2026-09-13',lastOpenedAt:null}));
    const sessions = ['s1','s2'].map((id,index)=>({id,workspaceId:'w'+(index+1),label:id,agent:'plugin',state:'idle',archived:false,externalSessionId:null,pluginInstallationId:null,capabilities:[],createdAt:'2026-09-13',updatedAt:'2026-09-13'}));
    window.navigationCalls=[];window.capabilitySchema='aibo.semantic-view/v1';let generation=0,revision=0;
    const contribution={installationId:'installation',contributionId:'dev.example.tool',title:'Capability tool',scope:'workspace',available:true,issue:null};
    const capabilitySnapshot=(detail=false)=>({schema:window.capabilitySchema,context:{workspaceId:'w1',contributionId:contribution.contributionId,generation:'generation:'+generation,revision:++revision},contribution:{id:contribution.contributionId,extensionPoint:'workspace.tool',title:'Capability tool'},state:{status:'ready',message:''},view:detail?{kind:'detail',itemId:'item',properties:[{label:'Source',value:'Provider'}],content:'Complete capability detail',truncated:false}:{kind:'collection',properties:[{key:'name',label:'Name',type:'text',values:[]}],items:[{id:'item',values:{name:'Capability item'}}],selection:null,page:{offset:0,size:50,total:1,truncated:false}},actions:[...(detail?[{id:'back',label:'Back',intent:'navigate',enabled:true},{id:'refresh',label:'Refresh',intent:'refresh',enabled:true}]:[{id:'inspect',label:'Inspect',intent:'inspect',enabled:true},{id:'refresh',label:'Refresh',intent:'refresh',enabled:true}]),...(window.capabilityWritable?[{id:'example.write',label:'Write',intent:'execute',enabled:true,input:{value:'frozen'}}]:[])]});

    const read=()=>JSON.parse(localStorage.getItem('probe.presentation.installed')||'null');
    const saved=()=>JSON.parse(localStorage.getItem('probe.presentation.selection')||'null');
    window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},
      transformCallback(fn){const id=++callback;window['_'+id]=fn;return id;},unregisterCallback(id){delete window['_'+id];},
      async invoke(command,args={}){
        window.presentationCommands.push(command);window.navigationCalls.push({command,args});
        if(command==='list_semantic_contributions')return [contribution,{...contribution,contributionId:'dev.example.unavailable',title:'目录原文 {title}',available:false,issue:'依赖或语义版本不可用',localizedIssue:{schema:'aibo.host-message/v1',key:'native.semantic.unavailableIssue',params:{}}}];
        if(command==='open_semantic_contribution'){generation++;revision=0;return capabilitySnapshot();}
        if(command==='act_semantic_contribution'){if(window.capabilityHold)await new Promise(resolve=>window.capabilityResolve=resolve);if(window.capabilityFailure)throw Error('timeout');if(window.capabilityFailurePayload)throw window.capabilityFailurePayload;if(args.action.actionId==='inspect')window.capabilityDetail=true;if(args.action.actionId==='back')window.capabilityDetail=false;return capabilitySnapshot(Boolean(window.capabilityDetail));}
        if(command==='write_semantic_contribution'){if(window.capabilityWriteFailure)throw window.capabilityWriteFailure;return {ok:true};}
        if(command==='release_semantic_contribution'||command==='cancel_semantic_open')return;
        if(command==='get_composer_draft')return null;
        if(command==='save_composer_draft')return {text:args.text,sendFailed:args.sendFailed,updatedAt:'2026-09-13'};
        if(command==='get_session_execution_profile'){
          const profile={schema:'aibo.execution-profile/v1',interactionMode:'ask',approvalPolicy:'on-request',filesystemPolicy:'read-only',commandPolicy:'disabled',networkPolicy:'disabled',model:null,reasoningEffort:null};
          return {schema:profile.schema,sessionId:args.sessionId,requested:profile,enforced:profile,unsupported:[],adapterCapabilities:[],nativeSandbox:true,resolvedAt:'2026-09-13',sessionControls:[]};
        }
        if(command==='list_workspaces')return workspaces;
        if(command==='inspect_workspace_capabilities')return {workspaceId:args.workspaceId,instructions:[],skills:[],tools:[],mcpServers:[],warnings:[]};
        if(command==='get_workspace_changes')return {workspaceId:args.workspaceId,dirty:false,files:[],captureStatus:'captured'};
        if(command==='list_workspace_git_repositories')return {repositories:[],limited:false,warnings:[]};
        if(command==='read_workspace_preferences')return {trustNewWorkspaces:true};
        if(command==='list_sessions')return sessions.filter(session=>session.workspaceId===args.workspaceId);
        if(command==='rename_session'){const session=sessions.find(session=>session.id===args.sessionId);session.label=args.label;return {...session};}
        if(command==='archive_session'){const session=sessions.find(session=>session.id===args.sessionId);session.archived=true;return {...session};}
        if(command==='unarchive_session'){const session=sessions.find(session=>session.id===args.sessionId);session.archived=false;return {...session};}

        if(command==='plugin:dialog|open')return '/probe/package';
        if(command==='install_presentation_package'){localStorage.setItem('probe.presentation.installed',JSON.stringify(window.presentationInstallable));return window.presentationInstallable.release;}
        if(command==='list_presentation_packages')return read()?[read().release]:[];
        if(command==='get_presentation_selection')return saved();
        if(command==='read_presentation_package'){const value=read();if(!value?.release.enabled)throw Error('unavailable');return value;}
        if(command==='select_presentation_package'){
          if(args.digest===null&&window.holdSchemaRecovery)await new Promise(resolve=>window.resolveSchemaRecovery=resolve);
          if((saved()?.digest??null)!==args.expectedDigest)throw Error('superseded');
          localStorage.setItem('probe.presentation.selection',JSON.stringify(args.digest?{digest:args.digest,themeId:args.themeId}:null));return;
        }
        if(command==='set_presentation_package_enabled'){const value=read();value.release.enabled=args.enabled;localStorage.setItem('probe.presentation.installed',JSON.stringify(value));if(!args.enabled)localStorage.removeItem('probe.presentation.selection');return;}
        if(command==='uninstall_presentation_package'){localStorage.removeItem('probe.presentation.installed');localStorage.removeItem('probe.presentation.selection');return;}
        if(command.startsWith('plugin:event|'))return 1;
        if(command==='get_app_snapshot')return {platform:'macos',appVersion:'probe',workspaceCount:0,diagnostics:[]};
        return [];
      }};
  },pkg);
  await page.addInitScript(({kit,theme})=>{if(window===window.top&&location.protocol==='http:'){localStorage.setItem('aibo.language.v1','zh-CN');localStorage.setItem('aibo.appearance.v1',JSON.stringify({kitId:kit,themeId:theme}));}},{kit:process.env.AIBO_PROBE_KIT??'material3',theme:process.env.AIBO_PROBE_THEME??'light'});
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`,{timeout:60000});
  await page.getByText('Aibo',{exact:true}).first().click();await page.keyboard.press('Control+,');
  await page.getByRole('tab',{name:'插件与能力',exact:true}).click();
  await page.getByRole('button',{name:'安装皮肤插件',exact:true}).click();
  await page.getByRole('tab',{name:'外观',exact:true}).click();
  await page.getByRole('button',{name:'External skin 1.0.0',exact:true}).click();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('probe.presentation.selection')||'null')!==null);
  await page.getByRole('button',{name:'关闭设置',exact:true}).click();
  const frame=page.frameLocator('iframe');
  const snapshot=()=>frame.getByLabel('Capability state').textContent().then(JSON.parse);
  const calls=command=>page.evaluate(command=>window.navigationCalls.filter(c=>c.command===command).length,command);
  await frame.getByRole('heading',{name:'External capability workbench'}).waitFor();
  const catalogBefore=await snapshot();const unavailable=catalogBefore.catalog.find(item=>item.contributionId==='dev.example.unavailable');
  assert.equal(unavailable.issue,'依赖或语义版本不可用');assert.equal(unavailable.title,'目录原文 {title}');assert.equal(unavailable.available,false);assert.equal('localizedIssue' in unavailable,false);
  const readsBeforeCatalog=await calls('list_semantic_contributions');
  const catalogLanguage=locale=>page.evaluate(async locale=>{const {language}=await import('/src/lib/i18n/runtime.ts');language.set({preference:locale,locale})},locale);
  await catalogLanguage('en');await frame.getByLabel('Capability state').filter({hasText:'Dependencies or the semantic version are unavailable.'}).waitFor();
  const englishCatalog=(await snapshot()).catalog.find(item=>item.contributionId==='dev.example.unavailable');
  assert.deepEqual(englishCatalog,{...unavailable,issue:'Dependencies or the semantic version are unavailable.'});assert.equal(await calls('list_semantic_contributions'),readsBeforeCatalog);
  await catalogLanguage('zh-CN');await frame.getByLabel('Capability state').filter({hasText:'依赖或语义版本不可用'}).waitFor();assert.equal(await calls('list_semantic_contributions'),readsBeforeCatalog);

  await frame.getByRole('button',{name:'open:installation:dev.example.tool',exact:true}).click();
  await frame.getByRole('button',{name:'semantic:inspect:item',exact:true}).click();
  await frame.getByRole('button',{name:'toggleReading',exact:true}).waitFor();
  assert.equal((await snapshot()).view.snapshot.view.content,'Complete capability detail');
  console.log('verified initial detail');
  const opened=await calls('open_semantic_contribution');const released=await calls('release_semantic_contribution');
  await page.getByText('Aibo',{exact:true}).first().click();await page.keyboard.press('Control+,');
  await page.getByRole('button',{name:'恢复内置皮肤',exact:true}).click();
  await page.getByRole('button',{name:'关闭设置',exact:true}).click();
  assert.equal(await calls('release_semantic_contribution'),released+1,'opening management explicitly closes the capability lease');
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox',{name:'全局搜索内容'}).fill('Capability tool');
  await page.getByText('Capability tool',{exact:true}).click();
  await page.getByText('Complete capability detail',{exact:true}).waitFor();
  await page.getByRole('button',{name:'切换布局',exact:true}).click();
  assert.equal(await calls('open_semantic_contribution'),opened+1);assert.equal(await calls('release_semantic_contribution'),released+1);
  await page.getByText('Aibo',{exact:true}).first().click();await page.keyboard.press('Control+,');
  await page.getByRole('button',{name:'External skin 1.0.0',exact:true}).click();
  await page.getByRole('button',{name:'关闭设置',exact:true}).click();
  await frame.getByRole('button',{name:'open:installation:dev.example.tool',exact:true}).click();
  await frame.getByRole('button',{name:'toggleReading',exact:true}).waitFor();
  assert.equal((await snapshot()).view.layout,'sidebar');assert.equal((await snapshot()).view.snapshot.view.content,'Complete capability detail');
  assert.equal(await calls('open_semantic_contribution'),opened+2);assert.equal(await calls('release_semantic_contribution'),released+2);
  console.log('verified management releases leases and reopening restores saved view');
  const switchLanguage=locale=>page.evaluate(async locale=>{const {language}=await import('/src/lib/i18n/runtime.ts');language.set({preference:locale,locale})},locale);
  const iframe=await page.locator('iframe').elementHandle();
  await page.evaluate(()=>window.capabilityHold=true);
  await frame.getByRole('button',{name:'semantic:refresh:',exact:true}).click();
  await page.waitForFunction(()=>typeof window.capabilityResolve==='function');
  assert.equal((await snapshot()).view.snapshot.state.message,'正在读取…');
  await switchLanguage('en');await frame.getByText('Reading…',{exact:false}).waitFor();
  assert.equal((await snapshot()).view.snapshot.state.message,'Reading…');
  assert.equal(await iframe.evaluate(node=>node.isConnected),true);
  assert.equal((await snapshot()).view.snapshot.context.generation,'generation:3');
  await switchLanguage('zh-CN');await page.evaluate(()=>{window.capabilityHold=false;window.capabilityResolve()});
  await page.waitForFunction(()=>!document.querySelector('[aria-busy="true"]'));
  await frame.getByRole('button',{name:'semantic:refresh:',exact:true}).waitFor();
  await page.evaluate(()=>window.capabilityFailure=true);
  await frame.getByRole('button',{name:'semantic:refresh:',exact:true}).click();
  await frame.getByText('读取超时，请重新加载。',{exact:false}).waitFor();
  const beforeFailure=await calls('open_semantic_contribution');
  await switchLanguage('en');await frame.getByText('The read timed out. Reload the page.',{exact:false}).waitFor();
  assert.equal(typeof (await snapshot()).view.error,'string');assert.equal((await snapshot()).view.snapshot,null);
  assert.equal(await calls('open_semantic_contribution'),beforeFailure);assert.equal(await iframe.evaluate(node=>node.isConnected),true);
  await switchLanguage('zh-CN');await page.evaluate(()=>window.capabilityFailure=false);
  await frame.getByRole('button',{name:'reload',exact:true}).click();
  await frame.getByRole('button',{name:'toggleReading',exact:true}).waitFor();
  console.log('verified live locale changes for loading and failure in the same external instance');

  const releasesBeforeClose=await calls('release_semantic_contribution');
  await frame.getByRole('button',{name:'close',exact:true}).click();
  await page.waitForFunction(count=>window.navigationCalls.filter(c=>c.command==='release_semantic_contribution').length===count+1,releasesBeforeClose);
  await frame.getByRole('button',{name:'open:installation:dev.example.tool',exact:true}).click();
  await frame.getByRole('button',{name:'toggleReading',exact:true}).waitFor();
  assert.equal((await snapshot()).view.snapshot.view.content,'Complete capability detail');
  console.log('verified reopen restores detail');
  await page.locator('iframe').evaluate(node=>node.setAttribute('data-probe-schema-recovery','same-instance'));
  await page.evaluate(()=>{window.capabilitySchema='aibo.semantic-view/v1.1';window.holdSchemaRecovery=true;});
  await frame.getByRole('button',{name:'reload',exact:true}).click();
  await page.waitForFunction(()=>typeof window.resolveSchemaRecovery==='function');
  await frame.getByLabel('Capability state').filter({hasText:translateMessage('zh-CN',{key:'workbench.unsupportedSnapshot',params:{}})}).waitFor();
  const incompatible=await snapshot();assert.equal(incompatible.view.snapshot,null);
  assert.equal(incompatible.view.error,translateMessage('zh-CN',{key:'workbench.unsupportedSnapshot',params:{}}));
  assert.equal(incompatible.selected.title,'Capability tool');
  const blockedCalls=await page.evaluate(()=>window.navigationCalls.filter(call=>['select_presentation_package','open_semantic_contribution','act_semantic_contribution','release_semantic_contribution','list_semantic_contributions','write_semantic_contribution'].includes(call.command)));
  for(const locale of ['en','zh-CN']){
    await catalogLanguage(locale);
    await frame.getByLabel('Capability state').filter({hasText:translateMessage(locale,{key:'workbench.unsupportedSnapshot',params:{}})}).waitFor();
    assert.deepEqual((await snapshot()).view,{...incompatible.view,error:translateMessage(locale,{key:'workbench.unsupportedSnapshot',params:{}})});
    assert.equal(await page.locator('iframe').getAttribute('data-probe-schema-recovery'),'same-instance');
    assert.deepEqual(await page.evaluate(()=>window.navigationCalls.filter(call=>['select_presentation_package','open_semantic_contribution','act_semantic_contribution','release_semantic_contribution','list_semantic_contributions','write_semantic_contribution'].includes(call.command))),blockedCalls);
  }
  await page.evaluate(()=>{window.holdSchemaRecovery=false;window.resolveSchemaRecovery();});
  await page.waitForFunction(()=>document.querySelectorAll('iframe').length===0&&JSON.parse(localStorage.getItem('probe.presentation.selection')||'null')===null);
  await page.getByRole('status').filter({hasText:'皮肤不支持此能力视图格式'}).waitFor();
  console.log('verified unsupported schema recovery');
  await page.getByText('Complete capability detail',{exact:true}).waitFor();
  await page.getByText('Aibo',{exact:true}).first().click();await page.keyboard.press('Control+,');
  await page.getByRole('button',{name:'External skin 1.0.0',exact:true}).click();
  await page.getByRole('button',{name:'关闭设置',exact:true}).click();
  await frame.getByRole('button',{name:'open:installation:dev.example.tool',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('iframe').length===0&&JSON.parse(localStorage.getItem('probe.presentation.selection')||'null')===null);
  await page.getByRole('status').filter({hasText:'皮肤不支持此能力视图格式'}).waitFor();
  assert.equal(await page.locator('iframe').count(),0);
  await page.getByText('Complete capability detail',{exact:true}).waitFor();

  // Reload the built-in fallback using the requested appearance after schema recovery.
  await page.reload({timeout:60000});await page.getByText('Aibo',{exact:true}).first().waitFor();
  await page.keyboard.press('Control+k');await page.getByRole('combobox',{name:'全局搜索内容'}).fill('Capability tool');
  await page.getByText('Capability tool',{exact:true}).click();await page.getByRole('button',{name:'Refresh',exact:true}).waitFor();
  for(const [error,zh,en] of [
    ...Object.keys(catalogs.en).filter(key=>key.startsWith('native.semantic.')&&key!=='native.semantic.unavailableIssue').map(key=>[{message:'原始语义拒绝 {error}',localized:{schema:'aibo.host-message/v1',key,params:{}}},translateMessage('zh-CN',{key,params:{}}),translateMessage('en',{key,params:{}})]),
    [{code:'busy',message:'原始诊断'},'工具正在执行其他操作，请稍后重试。','The tool is busy. Try again later.'],
    [{code:'other',message:'provider mentions permission_denied and timeout'},'读取失败，请重新加载。','The read failed. Reload the page.'],
    [{code:'session_operation_error',message:'原始诊断',localized:{schema:'aibo.host-message/v1',key:'native.search.binaryPreview',params:{}}},'二进制文件不提供文本预览','Text previews are unavailable for binary files.'],
    [{code:'provider_unavailable',message:'Capability storage is unavailable',invocationId:null,localized:{schema:'aibo.host-message/v1',key:'native.broker.storage',params:{}}},'能力存储不可用。','Capability storage is unavailable'],
    [{code:'invalid_input',message:'Input does not match the capability contract',invocationId:null,localized:{schema:'aibo.host-message/v1',key:'native.broker.inputContract',params:{}}},'输入不符合能力合同。','Input does not match the capability contract'],
  ]) {
    await page.evaluate(error=>window.capabilityFailurePayload=error,error);
    await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByRole('alert').filter({hasText:zh}).waitFor();
    const reads=await calls('act_semantic_contribution'),opens=await calls('open_semantic_contribution');
    await switchLanguage('en');await page.getByRole('alert').filter({hasText:en}).waitFor();
    assert.equal(await calls('act_semantic_contribution'),reads);assert.equal(await calls('open_semantic_contribution'),opens);
    await switchLanguage('zh-CN');await page.evaluate(()=>window.capabilityFailurePayload=null);
    await page.getByRole('button',{name:'重新加载',exact:true}).click();await page.getByRole('button',{name:'Refresh',exact:true}).waitFor();
  }

  await page.evaluate(()=>{window.capabilitySchema='aibo.semantic-view/v1.1';window.capabilityWritable=true;});
  await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByRole('button',{name:'Write',exact:true}).waitFor();
  for(const [error,zh,en] of [
    ...Object.keys(catalogs.en).filter(key=>key.startsWith('native.semanticWrite.')).map(key=>[{message:key==='native.semanticWrite.taskStopped'?'outcome_unknown: semantic write task stopped':'invalid_input: 原始语义写入拒绝 {error}',localized:{schema:'aibo.host-message/v1',key,params:{}}},translateMessage('zh-CN',{key,params:{}}),translateMessage('en',{key,params:{}})]),
    [{message:'approval_rejected: 原始审批拒绝',localized:{schema:'aibo.host-message/v1',key:'native.semanticWrite.disabled',params:{}}},'本次写入未获批准。刷新后可重新操作。','The write was not approved. Refresh the page before trying again.'],
    [{code:'outcome_unknown',message:'原始诊断'},'写入结果未知。请查看执行历史并核实实际结果，勿直接重试。','The write outcome is unknown. Check execution history and verify the result before retrying.'],
    [{code:'approval_rejected',message:'原始诊断'},'本次写入未获批准。刷新后可重新操作。','The write was not approved. Refresh the page before trying again.'],
    [{code:'outcome_unknown',message:'Approved capability execution did not produce a confirmed result (provider_raw); inspect its effects before another request',invocationId:'原始调用 /{id}',localized:{schema:'aibo.host-message/v1',key:'native.broker.writeUnconfirmed',params:{code:'provider_raw'}}},'已批准的能力执行未产生确认结果（provider_raw），请核对实际影响后再发起请求。','Approved capability execution did not produce a confirmed result (provider_raw); inspect its effects before another request'],
  ]) {
    await page.evaluate(error=>window.capabilityWriteFailure=error,error);
    const writes=await calls('write_semantic_contribution');
    await page.getByRole('button',{name:'Write',exact:true}).click();await page.getByRole('alert').filter({hasText:zh}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Write',exact:true}).isDisabled(),true);
    assert.equal(await page.getByRole('button',{name:'Refresh',exact:true}).isEnabled(),true);
    await switchLanguage('en');await page.getByRole('alert').filter({hasText:en}).waitFor();
    assert.equal(await calls('write_semantic_contribution'),writes+1);
    const request=await page.evaluate(()=>window.navigationCalls.filter(call=>call.command==='write_semantic_contribution').at(-1).args);
    assert.match(request.requestId,/^[0-9a-f-]{36}$/);assert.equal(request.action.context.workspaceId,'w1');assert.equal(request.action.actionId,'example.write');
    await switchLanguage('zh-CN');await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.installed-workbench button:disabled'));
  }
  console.log('verified structured errors, explicit native metadata and literal provider diagnostics in '+(process.env.AIBO_PROBE_KIT??'material3')+'/'+(process.env.AIBO_PROBE_THEME??'light'));
  assert.deepEqual(errors,[]);
  const result={passed:true,nativePort:'mocked; actual App, default capability view and Worker',browser:browser.version(),checks:['open contribution and inspect semantic item','full provider detail exposed', 'loading and timeout messages update with locale without replacing the iframe or reopening the capability','management closes capability leases and reopening in either presentation restores saved view','layout preference survives switches','explicit close releases lease','reopen restores detail','unsupported snapshot falls back without delivering undeclared data','opening an unsupported capability after selecting a skin returns to the host without leaking its snapshot']};
  await writeFile('/tmp/aibo-capability-workbench-browser.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));

} catch(error) { console.error(JSON.stringify({errors,body:await page.locator('body').innerText()})); throw error; } finally {await browser.close();await server.close();}
