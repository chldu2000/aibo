import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import {buildPresentationSkins} from './lib/build-presentation-skins.mjs';
const built=await buildPresentationSkins();const pkg=built.packages[0];
const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false,watch:null}});await server.listen();
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];
page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(10000);
try {
  await page.addInitScript(pkg=>{
    let callback=0;window.presentationCopies=[];window.presentationLinks=[];Object.defineProperty(navigator,'clipboard',{value:{writeText:async value=>window.presentationCopies.push(value)},configurable:true});window.open=(...args)=>{window.presentationLinks.push(args);return null};window.presentationCommands=[];window.presentationInstallable=pkg;
    const workspaces = ['w1','w2'].map(id=>({id,label:id,path:'/probe/'+id,trust:'trusted',createdAt:'2026-09-13',updatedAt:'2026-09-13',lastOpenedAt:null}));
    const sessions = ['s1','s2'].map((id,index)=>({id,workspaceId:'w'+(index+1),label:id,agent:'plugin',state:'idle',archived:false,externalSessionId:null,pluginInstallationId:'provider',capabilities:['queue.manage','model.list','model.select','model.reasoning','compaction.run'],createdAt:'2026-09-13',updatedAt:'2026-09-13'}));
    window.navigationCalls=[];
    const model={reference:'model-a',label:'Model A',id:'a',provider:'probe',description:null,isDefault:true,defaultReasoningEffort:null,reasoningEfforts:[{id:'high',label:'High',description:null}]};
    const catalog={current:model,models:[model],currentReasoningEffort:null,reasoningEfforts:model.reasoningEfforts};
    let agentHandler=null,sequence=0;
    window.emitAgent=(type,payload)=>{const event={schemaVersion:'2.0',eventId:'event:'+ ++sequence,generationId:'generation',sequence,occurredAt:new Date().toISOString(),source:{pluginId:'dev.example.provider',pluginVersion:'1.0.0'},workspaceId:'w1',sessionId:'s1',turnId:'turn',type,payload};if(type==='session.state_changed')sessions[0].state=payload.state;window['_'+agentHandler]({event:'agent-event',id:1,payload:event});};

    const read=()=>JSON.parse(localStorage.getItem('probe.presentation.installed')||'null');
    const saved=()=>JSON.parse(localStorage.getItem('probe.presentation.selection')||'null');
    window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},
      transformCallback(fn){const id=++callback;window['_'+id]=fn;return id;},unregisterCallback(id){delete window['_'+id];},
      async invoke(command,args={}){
        window.presentationCommands.push(command);window.navigationCalls.push({command,args});
        if(command==='plugin:event|listen'){if(args.event==='agent-event')agentHandler=args.handler;return 1;}
        if(command==='inspect_workspace_capabilities')return {workspaceId:args.workspaceId,inspectedAt:'now',instructions:[],skills:[],tools:[],mcpServers:[],warnings:[]};
        if(command==='get_workspace_changes')return {workspaceId:args.workspaceId,head:'head',branch:'main',dirty:false,capturedAt:'now',files:[],captureStatus:'captured',captureError:null};
        if(command==='get_workspace_git_remote_status')return {branch:'main',upstream:null,ahead:0,behind:0};
        if(command==='get_turn_change_set')return null;
        if(command==='list_session_attachments')return [{schema:'aibo.context-attachment/v1',id:'pending',workspaceId:'w1',sessionId:args.sessionId,turnId:null,path:'pending.txt',contentHash:null,size:0,mediaType:'text/plain',source:'picker',sendStrategy:'reference',createdAt:'now'},{schema:'aibo.context-attachment/v1',id:'sent',workspaceId:'w1',sessionId:args.sessionId,turnId:'turn',path:'sent.txt',contentHash:null,size:12,mediaType:'text/plain',source:'picker',sendStrategy:'inline',createdAt:'now'}];
        if(command==='get_session_models')return catalog;
        if(command==='get_timeline')return [{id:'message',sessionId:args.sessionId,turnId:'turn',externalMessageId:null,role:'assistant',toolName:'tool-name',entryType:'note',content:'Complete timeline data\n\n## Rich heading\n\n**Bold message** and `inline` [Reference](https://example.invalid)\n\n- Item one\n- Item two\n\n```js\nconst answer = 42;\n```\n[AIBO_CONTEXT_ATTACHMENTS]internal metadata[/AIBO_CONTEXT_ATTACHMENTS]',status:'completed',createdAt:'2026-09-13',updatedAt:'2026-09-13'},...([{id:'tool-message',role:'tool',toolName:'commandExecution',entryType:'tool_call',content:'**literal tool arguments**\n<script>literal</script>'},{id:'tool-result',role:'tool',toolName:'commandExecution',entryType:'tool_result',content:'literal tool result'},{id:'reasoning-message',role:'system',toolName:'reasoning',entryType:'note',content:'## Reasoning detail'}].map(item=>({...item,sessionId:args.sessionId,turnId:'turn',externalMessageId:null,status:'completed',createdAt:'2026-09-13',updatedAt:'2026-09-13'})))];
        if(command==='invoke_agent_capability'){if(args.capability==='model.reasoning')catalog.currentReasoningEffort=args.input.level;return {};}
        if(command==='send_agent_prompt')return {...sessions.find(session=>session.id===args.sessionId),state:'idle'};
        if(command==='resolve_agent_user_input')return;
        if(command==='get_composer_draft')return null;
        if(command==='save_composer_draft')return {text:args.text,sendFailed:args.sendFailed,updatedAt:'2026-09-13'};
        if(command==='get_session_execution_profile'){
          const profile={schema:'aibo.execution-profile/v1',interactionMode:'ask',approvalPolicy:'on-request',filesystemPolicy:'read-only',commandPolicy:'disabled',networkPolicy:'disabled',model:null,reasoningEffort:null};
          return {schema:profile.schema,sessionId:args.sessionId,requested:{...profile,filesystemPolicy:'danger-full-access'},enforced:profile,unsupported:['network'],adapterCapabilities:['model.select'],nativeSandbox:true,resolvedAt:'2026-09-13'};
        }
        if(command==='list_workspaces')return workspaces;
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
          if((saved()?.digest??null)!==args.expectedDigest)throw Error('superseded');
          localStorage.setItem('probe.presentation.selection',JSON.stringify(args.digest?{digest:args.digest,themeId:args.themeId}:null));return;
        }
        if(command==='set_presentation_package_enabled'){const value=read();value.release.enabled=args.enabled;localStorage.setItem('probe.presentation.installed',JSON.stringify(value));if(!args.enabled)localStorage.removeItem('probe.presentation.selection');return;}
        if(command==='uninstall_presentation_package'){localStorage.removeItem('probe.presentation.installed');localStorage.removeItem('probe.presentation.selection');return;}
        if(command.startsWith('plugin:event|'))return 1;
        if(command==='probe_agents')return [{agent:'plugin',label:'Probe Agent',status:'ready',executable:'/probe/agent',version:'1.2.3',capabilities:['model.list'],authState:'ready',message:'Diagnostic detail'}];
        if(command==='get_app_snapshot')return {platform:'macos',appVersion:'probe',workspaceCount:0,diagnostics:[{agent:'plugin',label:'Probe Agent',status:'ready',executable:'/probe/agent',version:'1.2.3',capabilities:['model.list'],authState:'ready',message:'Diagnostic detail'}]};
        return [];
      }};
  },pkg);
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
  const frame=page.frameLocator('.presentation-external iframe');
  for(const pkg of built.packages){
    await page.evaluate(pkg=>window.presentationInstallable=pkg,pkg);
    await page.getByRole('button',{name:'打开设置',exact:true}).click();
    await page.getByRole('button',{name:'安装皮肤插件',exact:true}).click();
    await page.getByRole('button',{name:pkg.release.manifest.displayName+' '+pkg.release.manifest.version,exact:true}).click();
    await page.getByRole('button',{name:'完成',exact:true}).click();
    await frame.getByRole('heading',{name:'工作区',exact:true}).waitFor();
    if(!await frame.getByRole('button',{name:'s1',exact:true}).count())await frame.getByRole('button',{name:'w1',exact:true}).click();
    await frame.getByRole('button',{name:'s1',exact:true}).click();
    const layout=frame.locator('[data-presentation-key="workbench:layout"]');
    if(await layout.getAttribute('open')===null)await frame.getByText('布局',{exact:true}).click();
    const width=frame.getByRole('slider',{name:'导航宽度',exact:true});
    await width.focus();await width.press('ArrowRight');
    let resized=Number(await width.inputValue());
    await frame.locator(`input[aria-label="导航宽度"][value="${resized}"]`).waitFor();
    assert.ok(resized>260);
    await frame.locator('.navigation').waitFor({state:'visible'});
    assert.equal(await frame.locator('.navigation').evaluate(element=>Math.round(element.getBoundingClientRect().width)),resized);
    const dragBoundary=async(label,delta,direction=label==='调整导航宽度'?1:-1)=>{
      const separator=frame.getByRole('separator',{name:label,exact:true});
      const start=Number(await separator.getAttribute('aria-valuenow')),box=await separator.boundingBox();
      await page.mouse.move(box.x+box.width/2,box.y+80);await page.mouse.down();
      await page.mouse.move(box.x+box.width/2+delta,box.y+80,{steps:4});await page.mouse.up();
      const expected=start+delta*direction;
      await frame.locator(`[role="separator"][aria-label="${label}"][aria-valuenow="${expected}"]`).waitFor();
      return expected;
    };
    resized=await dragBoundary('调整导航宽度',32);
    const auxiliaryWidth=await dragBoundary('调整侧边面板宽度',-24);
    assert.equal(await frame.locator('.workbench-inspector').evaluate(element=>Math.round(element.getBoundingClientRect().width)),auxiliaryWidth);
    const auxiliarySplitter=frame.getByRole('separator',{name:'调整侧边面板宽度',exact:true});
    await auxiliarySplitter.focus();await auxiliarySplitter.press('ArrowRight');
    await frame.locator(`[role="separator"][aria-label="调整侧边面板宽度"][aria-valuenow="${auxiliaryWidth-16}"]`).waitFor();

    const composer=frame.getByRole('textbox',{name:'消息',exact:true});await composer.waitFor();
    await composer.fill('布局保留草稿');
    await frame.locator('textarea[aria-label="消息"][value="布局保留草稿"]').waitFor();
    await frame.getByRole('button',{name:'审阅布局',exact:true}).click();
    await frame.locator('button[data-presentation-key="layout:mode:review"][aria-pressed="true"]').waitFor();
    assert.ok((await frame.locator('.navigation').boundingBox()).x>(await frame.locator('.workbench-inspector').boundingBox()).x);
    resized=await dragBoundary('调整导航宽度',-16,-1);
    await frame.getByRole('button',{name:'专注会话',exact:true}).click();
    await frame.locator('button[data-presentation-key="layout:mode:focus"][aria-pressed="true"]').waitFor();
    assert.equal(await frame.locator('.navigation,.workbench-inspector,.workbench-splitter').count(),0);
    assert.equal(await composer.inputValue(),'布局保留草稿');
    await frame.getByRole('button',{name:'标准布局',exact:true}).click();
    await frame.locator('button[data-presentation-key="layout:mode:standard"][aria-pressed="true"]').waitFor();
    assert.equal(await composer.inputValue(),'布局保留草稿');

    await frame.getByText('Complete timeline data',{exact:true}).waitFor();
    await frame.getByRole('heading',{name:'Rich heading',exact:true}).waitFor();
    const toolGroup=frame.locator('[data-presentation-key="message-group:tool-group-tool-message"]');
    if(await toolGroup.getAttribute('open')===null)await frame.getByText('工具调用 · 2 项 · 2/2 完成',{exact:true}).click();
    for(const [id,label] of [['tool-message','命令执行 · 查看调用参数'],['reasoning-message','思考 · 查看详情']]){
      const disclosure=frame.locator(`[data-presentation-key="message:${id}:disclosure"]`);
      if(await disclosure.getAttribute('open')!==null)await frame.getByText(label,{exact:true}).click();
      await frame.getByText(label,{exact:true}).click();
      assert.equal(await disclosure.getAttribute('open'),'');
    }
    assert.equal(await frame.locator('[data-presentation-key="message:content:tool-message"]').textContent(),'**literal tool arguments**\n<script>literal</script>');
    await frame.getByRole('heading',{name:'Reasoning detail',exact:true}).waitFor();
    await frame.getByRole('button',{name:'复制代码',exact:true}).click();
    await page.waitForFunction(()=>window.presentationCopies.includes('const answer = 42;'));
    await frame.getByRole('link',{name:'Reference',exact:true}).click();
    await page.waitForFunction(()=>window.presentationLinks.some(args=>args[0]==='https://example.invalid'));
    assert.equal(await frame.getByText('internal metadata',{exact:true}).count(),0);
    await composer.fill('');await composer.pressSequentially('完整皮肤 keeps draft',{delay:12});
    await page.waitForTimeout(200);assert.equal(await composer.inputValue(),'完整皮肤 keeps draft');
    await composer.press('Control+Enter');
    await page.waitForFunction(()=>window.navigationCalls.some(c=>c.command==='send_agent_prompt'&&c.args.input.startsWith('完整皮肤 keeps draft')&&c.args.input.includes('[AIBO_CONTEXT_ATTACHMENTS]')));
    await frame.locator('textarea[aria-label="消息"][value=""]:enabled').waitFor();
    await composer.fill('换肤保留');
    await frame.locator('textarea[aria-label="消息"][value="换肤保留"]:enabled').waitFor();
    await frame.getByRole('button',{name:'Git',exact:true}).click();
    await frame.getByRole('heading',{name:'Git',exact:true}).waitFor();
    await frame.getByRole('button',{name:'上下文',exact:true}).click();
    await frame.getByRole('heading',{name:'工程动作',exact:true}).waitFor();
    const inspector=frame.locator('.workbench-inspector');
    await inspector.getByRole('heading',{name:'执行权限',exact:true}).waitFor();
    assert.equal(await inspector.locator('[data-presentation-key="inspector:execution-profile:requested:filesystemPolicy"]').textContent(),'完整文件访问');
    assert.equal(await inspector.locator('[data-presentation-key="inspector:execution-profile:enforced:filesystemPolicy"]').textContent(),'只读');
    await inspector.getByText('待发送 · 工作区引用 · 0 字节',{exact:true}).waitFor();
    await inspector.getByText('已发送 · 内联 · 12 字节',{exact:true}).waitFor();
    await inspector.getByText('Diagnostic detail',{exact:true}).waitFor();
    await page.screenshot({path:'/tmp/aibo-full-'+pkg.release.manifest.id.split('.').at(-1)+'.png',fullPage:true});
    await page.getByRole('button',{name:'打开设置',exact:true}).click();
    await page.getByRole('button',{name:'恢复内置呈现',exact:true}).click();
    assert.equal(await page.getByRole('button',{name:`调整工作区与会话宽度，当前 ${resized} 像素`,exact:true}).count(),1);
    await page.getByRole('button',{name:pkg.release.manifest.displayName+' '+pkg.release.manifest.version,exact:true}).click();
    await page.getByRole('button',{name:'完成',exact:true}).click();
    await frame.locator('.navigation').waitFor({state:'visible'});
    assert.equal(await frame.locator('.navigation').evaluate(element=>Math.round(element.getBoundingClientRect().width)),resized);
    await composer.waitFor();assert.equal(await composer.inputValue(),'换肤保留');
    if(await frame.locator('[data-presentation-key="workbench:layout"]').getAttribute('open')===null)await frame.getByText('布局',{exact:true}).click();
    await frame.getByRole('button',{name:'审阅布局',exact:true}).click();
    await page.waitForFunction(()=>localStorage.getItem('aibo.workbench-presentation.v1.main')==='review');
    await frame.getByRole('button',{name:'侧边面板',exact:true}).click();
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('aibo.workbench-layout.v1.main')||'null')?.auxiliaryOpen===false);
    const savedLayout=await page.evaluate(()=>JSON.parse(localStorage.getItem('aibo.workbench-layout.v1.main')));
    await page.reload();
    await frame.locator('.navigation').waitFor({state:'visible'});
    assert.equal(await frame.locator('.navigation').evaluate(element=>Math.round(element.getBoundingClientRect().width)),resized);
    assert.equal(await frame.getByRole('button',{name:'侧边面板',exact:true}).getAttribute('aria-expanded'),'false');
    assert.equal(await frame.getByRole('button',{name:'上下文',exact:true}).getAttribute('aria-pressed'),'true');
    await frame.getByRole('button',{name:'侧边面板',exact:true}).click();
    await frame.locator('.workbench-inspector').waitFor({state:'visible'});
    assert.equal(await frame.locator('.workbench-inspector').evaluate(element=>Math.round(element.getBoundingClientRect().width)),savedLayout.auxiliaryWidth);
    assert.ok((await frame.locator('.navigation').boundingBox()).x>(await frame.locator('.workbench-inspector').boundingBox()).x);
    if(await frame.locator('[data-presentation-key="workbench:layout"]').getAttribute('open')===null)await frame.getByText('布局',{exact:true}).click();
    await frame.getByRole('button',{name:'标准布局',exact:true}).click();
    await frame.locator('button[data-presentation-key="layout:mode:standard"][aria-pressed="true"]').waitFor();


    await page.getByRole('button',{name:'打开设置',exact:true}).click();
    await page.getByRole('button',{name:'恢复内置呈现',exact:true}).click();
    await page.getByRole('button',{name:'完成',exact:true}).click();
  }
  assert.deepEqual(errors,[]);
  const result={passed:true,nativePort:'mocked; actual App and independently built full skin Workers',browser:browser.version(),checks:['focus and review modes, reversed drag, draft preservation and mode reload','reload restores both widths, panel visibility and selected view','both splitter drag directions and auxiliary keyboard resize','keyboard width adjustment and default/external width retention','primary Enter submits through host action','consecutive tool group with completion count','literal tool payloads and native reasoning disclosure in both skins','both full packages install and activate','workspace and session navigation','rich timeline headings, lists, inline and fenced code','host-bound code copy and link actions','attachment transport metadata hidden','rapid Chinese/English input and send','Git/context panel switching','requested and enforced permissions remain distinct','attachment status, strategy and size','diagnostic details remain visible','default/external switch retains host draft']};
  await writeFile('/tmp/aibo-full-skins-browser.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
} catch(error) {console.error(JSON.stringify({errors,body:await page.locator('body').innerText()}));throw error;} finally {await browser.close();await server.close();await built.dispose();}
