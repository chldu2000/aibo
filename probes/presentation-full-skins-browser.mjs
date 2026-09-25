import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import {buildPresentationSkins} from './lib/build-presentation-skins.mjs';
import {probePresentationApprovalFault} from './lib/presentation-approval-fault.mjs';
const built=await buildPresentationSkins();const pkg=built.packages[0];
const server=await createServer({server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false,watch:null}});await server.listen();
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];
page.on('pageerror',error=>errors.push(error.stack ?? error.message));page.setDefaultTimeout(10000);
try {
  const builtInKit = process.env.AIBO_BUILTIN_KIT ?? 'ak-ui';
  assert.ok(['ak-ui','material3'].includes(builtInKit));
  await page.addInitScript(kit => {
    if (window === window.top && !localStorage.getItem('aibo.appearance.v1')) localStorage.setItem('aibo.appearance.v1', JSON.stringify({kitId:kit,themeId:'light'}));
  }, builtInKit);
  await page.addInitScript(pkg=>{
    let callback=0;window.presentationCopies=[];window.presentationLinks=[];Object.defineProperty(navigator,'clipboard',{value:{writeText:async value=>window.presentationCopies.push(value)},configurable:true});window.open=(...args)=>{window.presentationLinks.push(args);return null};window.presentationCommands=[];window.presentationInstallable=pkg;
    const workspaces = ['w1','w2'].map(id=>({id,label:id,path:'/probe/'+id,trust:'trusted',createdAt:'2026-09-13',updatedAt:'2026-09-13',lastOpenedAt:null}));
    const sessions = ['s1','s2'].map((id,index)=>({id,workspaceId:'w'+(index+1),label:id,agent:'plugin',state:'idle',archived:false,externalSessionId:null,pluginInstallationId:'provider',capabilities:['command.list','queue.manage','model.list','model.select','model.reasoning','compaction.run'],createdAt:'2026-09-13',updatedAt:'2026-09-13'}));
    window.navigationCalls=[];
    const model={reference:'model-a',label:'Model A',id:'a',provider:'probe',description:null,isDefault:true,defaultReasoningEffort:null,serviceTiers:[],contextWindows:[],reasoningEfforts:[{id:'high',label:'High',description:null}]};
    const catalog={current:model,models:[model],currentReasoningEffort:null,reasoningEfforts:model.reasoningEfforts};
    let agentHandler=null,sequence=0;
    window.emitAgent=(type,payload)=>{const event={schemaVersion:'2.0',eventId:'event:'+ ++sequence,generationId:'generation',sequence,occurredAt:new Date().toISOString(),source:{pluginId:'dev.example.provider',pluginVersion:'1.0.0'},workspaceId:'w1',sessionId:'s1',turnId:'turn',type,payload};if(type==='session.state_changed')sessions[0].state=payload.state;window['_'+agentHandler]({event:'agent-event',id:1,payload:event});};

    const read=()=>JSON.parse(localStorage.getItem('probe.presentation.installed')||'null');
    const saved=()=>JSON.parse(localStorage.getItem('probe.presentation.selection')||'null');
    window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},
      transformCallback(fn){const id=++callback;window['_'+id]=fn;return id;},unregisterCallback(id){delete window['_'+id];},
      async invoke(command,args={}){
        if(command==='read_workspace_preferences')return {trustNewWorkspaces:true};
        window.presentationCommands.push(command);window.navigationCalls.push({command,args});
        if(command==='plugin:event|listen'){if(args.event==='agent-event')agentHandler=args.handler;return 1;}
        if(command==='inspect_workspace_capabilities')return {workspaceId:args.workspaceId,inspectedAt:'now',instructions:[],skills:[],tools:[],mcpServers:[],warnings:[]};
        if(window.sessionTabsFixture && command==='list_workspace_git_repositories')return {repositories:[{id:'repo',name:'repo',relativePath:'.',kind:'repository'}],limited:false,warnings:[]};
        if(window.sessionTabsFixture && command==='get_workspace_changes')return {workspaceId:args.workspaceId,head:'head',branch:'main',dirty:true,capturedAt:'now',files:[{path:'tab-test.txt',kind:'modified',staged:true,unstaged:true,untracked:false,conflicted:false}],captureStatus:'captured',captureError:null};
        if(window.sessionTabsFixture && command==='get_workspace_file_diff')return {path:args.path,staged:args.staged,available:true,truncated:false,diff:'diff --git a/tab-test.txt b/tab-test.txt\n@@ -1 +1 @@\n-old\n+'+(args.staged?'staged-result':'working-result'),hunks:[],reason:null};
        if(command==='get_workspace_changes')return {workspaceId:args.workspaceId,head:'head',branch:'main',dirty:false,capturedAt:'now',files:[],captureStatus:'captured',captureError:null};
        if(command==='get_workspace_git_remote_status')return {branch:'main',upstream:null,ahead:0,behind:0};
        if(command==='get_turn_change_set')return null;
        if(command==='list_session_attachments')return [{schema:'aibo.context-attachment/v1',id:'pending',workspaceId:'w1',sessionId:args.sessionId,turnId:null,path:'pending.txt',contentHash:null,size:0,mediaType:'text/plain',source:'picker',sendStrategy:'reference',createdAt:'now'},{schema:'aibo.context-attachment/v1',id:'sent',workspaceId:'w1',sessionId:args.sessionId,turnId:'turn',path:'sent.txt',contentHash:null,size:12,mediaType:'text/plain',source:'picker',sendStrategy:'inline',createdAt:'now'}];
        if(command==='get_session_models')return catalog;
        if(command==='invoke_agent_capability'&&args.capability==='command.list')return {commands:[{name:'help',description:'Help command',source:'agent'},{name:'hello',description:'Hello command',source:'agent'},{name:'heal',description:'Healing skill',source:'skill'},{name:'height',description:'Height prompt',source:'prompt'}]};
        if(command==='search_workspace_paths')return [{path:'src/one.ts',isDirectory:false},{path:'src/two.ts',isDirectory:false}];
        if(command==='get_timeline')return [{id:'message',sessionId:args.sessionId,turnId:'turn',externalMessageId:null,role:'assistant',toolName:'tool-name',entryType:'note',content:'Complete timeline data\n\n## Rich heading\n\n**Bold message** and `inline` [Reference](https://example.invalid)\n\n- Item one\n- Item two\n\n```js\nconst answer = 42;\n```\n[AIBO_CONTEXT_ATTACHMENTS]internal metadata[/AIBO_CONTEXT_ATTACHMENTS]',status:'completed',createdAt:'2026-09-13',updatedAt:'2026-09-13'},...([{id:'tool-message',role:'tool',toolName:'commandExecution',entryType:'tool_call',content:'**literal tool arguments**\n<script>literal</script>'},{id:'tool-result',role:'tool',toolName:'commandExecution',entryType:'tool_result',content:'literal tool result'},{id:'reasoning-message',role:'system',toolName:'reasoning',entryType:'note',content:'## Reasoning detail'}].map(item=>({...item,sessionId:args.sessionId,turnId:'turn',externalMessageId:null,status:'completed',createdAt:'2026-09-13',updatedAt:'2026-09-13'}))),...Array.from({length:16},(_,index)=>({id:'scroll-'+index,sessionId:args.sessionId,turnId:'turn',externalMessageId:null,role:'assistant',toolName:null,entryType:'note',content:'Scroll message '+index+'\n\n'+('Anchor paragraph. '.repeat(30)),status:'completed',createdAt:'2026-09-13',updatedAt:'2026-09-13'}))];
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
  assert.equal(await page.locator('.app-shell').getAttribute('data-ui-kit'), builtInKit);
  await page.evaluate(()=>window.sessionTabsFixture=true);
  const workspaceButton=page.getByRole('button',{name:'w1，可信',exact:true});
  await workspaceButton.waitFor();
  if(await workspaceButton.getAttribute('aria-expanded')!=='true')await workspaceButton.click();
  await page.getByText('s1',{exact:true}).first().click();
  // Session rows keep routine state text out of the list and reserve tags for blockers.
  const sessionRow = page.locator('.session-item').filter({has:page.locator('.session-item-label', {hasText:'s1'})}).first();
  for (const [state, label, running] of [
    ['running', null, true], ['starting', null, true], ['compacting', null, true],
    ['waiting_approval', '待审批', false], ['waiting_user', '待你输入', false],
    ['failed', '失败', false], ['interrupted', '已中断', false],
    ['idle', null, false], ['closed', null, false], ['created', null, false],
  ]) {
    await page.evaluate(state=>window.emitAgent('session.state_changed',{state}),state);
    await page.waitForFunction(({label,running})=>{
      const row=[...document.querySelectorAll('.session-item')].find(row=>row.querySelector('.session-item-label')?.textContent==='s1');
      return row && (row.querySelector('.session-state-label')?.textContent ?? null)===label && !!row.querySelector('.agent-status-orbit')===running;
    },{label,running});
    assert.equal(await sessionRow.locator('time').count(),label ? 0 : 1);
    assert.equal(await sessionRow.locator('.agent-status-signal').count(),0);
    if(running) {
      assert.equal(await sessionRow.locator('.agent-status-orbit circle').count(),1);
      assert.equal(await sessionRow.locator('.agent-status-orbit').evaluate(el=>getComputedStyle(el).animationName),builtInKit === 'material3' ? 'md-status-track' : 'ak-status-track');
    } else {
      assert.equal(await sessionRow.locator('.agent-status-mark').evaluate(el=>getComputedStyle(el).outlineStyle),'none');
    }
  }
  await page.evaluate(()=>window.emitAgent('session.state_changed',{state:'idle'}));
  const tabs=page.getByRole('tablist',{name:'会话视图'});
  const toolGroup=page.locator('.tool-group').filter({hasText:'2 个工具调用'}).first();
  await toolGroup.locator(':scope > summary').click();
  const toolRows=await toolGroup.locator('.tool-output > summary').evaluateAll(els=>els.map(el=>el.getBoundingClientRect().height));
  assert.equal(toolRows.length,2);
  assert.ok(toolRows.every(height=>height===36),'expanded tool summaries are 36px');
  await tabs.getByRole('tab',{name:'执行记录',exact:true}).click();
  const executions=page.locator('#session-panel-executions');
  await executions.locator('.execution-record').first().waitFor();
  assert.equal(await executions.locator('.execution-record').count(),2);
  await executions.getByRole('button',{name:/查看执行结果$/}).click();
  await executions.getByText('literal tool result',{exact:true}).waitFor();
  await tabs.getByRole('tab',{name:/^变更/}).click();
  const changes=page.locator('#session-panel-changes');
  await changes.getByText('tab-test.txt',{exact:true}).waitFor();
  assert.equal(await changes.locator('.session-changes-repo').count(),1);
  const fileRow=changes.getByRole('button',{name:'tab-test.txt，修改，部分暂存',exact:true});
  assert.equal((await fileRow.boundingBox()).height,36,'change rows match the design density');
  await fileRow.click();
  await changes.getByText('working-result',{exact:true}).waitFor();
  assert.equal(await fileRow.getAttribute('aria-expanded'),'true');
  assert.equal(await fileRow.locator('..').locator('.session-change-preview .workspace-file-diff-preview').count(),1,'preview belongs to its file row');
  await changes.getByRole('button',{name:'暂存区',exact:true}).click();
  await changes.getByText('staged-result',{exact:true}).waitFor();
  await changes.getByRole('button',{name:'工作区',exact:true}).click();
  await changes.getByText('working-result',{exact:true}).waitFor();
  await tabs.getByRole('tab',{name:'对话',exact:true}).click();
  await page.evaluate(()=>window.sessionTabsFixture=false);
  const frame=page.frameLocator('.presentation-external iframe');
  for(const pkg of built.packages){
    await page.evaluate(pkg=>window.presentationInstallable=pkg,pkg);
    await page.getByRole('button',{name:/^打开工作台设置/}).click();
    await page.getByRole('tab',{name:'插件与能力',exact:true}).click();
    await page.getByRole('button',{name:'安装皮肤插件',exact:true}).click();
    await page.getByRole('tab',{name:'外观',exact:true}).click();
    await page.getByRole('button',{name:pkg.release.manifest.displayName+' '+pkg.release.manifest.version,exact:true}).click();
    await page.getByRole('button',{name:'关闭设置',exact:true}).click();
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
    await composer.fill('/he');await frame.getByRole('listbox',{name:'命令建议'}).waitFor();
    await composer.press('ArrowDown');await composer.press('Enter');
    await frame.locator('textarea[aria-label="消息"][value="/hello "]').waitFor();
    assert.equal(await composer.evaluate(element=>element.selectionStart),'/hello '.length);
    await composer.fill('/he');await frame.getByRole('listbox',{name:'命令建议'}).waitFor();
    await composer.press('Tab');await composer.press('Tab');
    await frame.getByRole('option',{name:'/heal',exact:true}).waitFor();
    assert.equal(await frame.getByRole('option',{name:'/hello',exact:true}).isVisible(),false);
    await composer.press('Shift+Tab');await frame.getByRole('option',{name:'/hello',exact:true}).waitFor();
    await frame.getByRole('button',{name:'Extension (1)',exact:true}).click();
    assert.equal(await frame.getByRole('button',{name:'Extension (1)',exact:true}).getAttribute('aria-pressed'),'true');
    assert.equal(await frame.getByRole('listbox',{name:'命令建议',exact:true}).getByRole('button').count(),0);
    assert.equal(await composer.getAttribute('aria-controls'),await frame.getByRole('listbox',{name:'命令建议',exact:true}).getAttribute('id'));
    await frame.getByRole('option',{name:'/height',exact:true}).click();
    await frame.locator('textarea[aria-label="消息"][value="/height "]').waitFor();
    assert.equal(await composer.evaluate(element=>element===document.activeElement&&element.selectionStart===element.value.length),true);

    await composer.fill('/he');await frame.getByRole('listbox',{name:'命令建议'}).waitFor();
    await composer.press('Escape');await frame.getByRole('listbox',{name:'命令建议'}).waitFor({state:'hidden'});
    await composer.press('Enter');assert.equal(await composer.inputValue(),'/he\n');
    await composer.fill('@src');await frame.getByRole('listbox',{name:'引用建议'}).waitFor();
    await frame.getByRole('option',{name:'src/two.ts',exact:true}).waitFor();
    await composer.press('ArrowDown');await composer.press('Enter');
    await page.waitForFunction(()=>window.navigationCalls.some(call=>call.command==='register_session_attachments'&&call.args.paths.includes('src/two.ts')));
    await frame.locator('textarea[aria-label="消息"][value="@src/two.ts "]').waitFor();
    assert.equal(await composer.evaluate(element=>element.selectionStart),'@src/two.ts '.length);
    await composer.fill('@src');await frame.getByRole('listbox',{name:'引用建议'}).waitFor();
    await frame.getByRole('option',{name:'src/two.ts',exact:true}).waitFor();
    const sendsBeforePath=await page.evaluate(()=>window.navigationCalls.filter(call=>call.command==='send_agent_prompt').length);
    await composer.press('Control+Enter');
    await frame.locator('textarea[aria-label="消息"][value="@src/one.ts "]').waitFor();
    assert.equal(await page.evaluate(()=>window.navigationCalls.filter(call=>call.command==='send_agent_prompt').length),sendsBeforePath);


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
    if(await frame.locator('[data-presentation-key="workbench:layout"]').getAttribute('open')!==null)await frame.getByText('布局',{exact:true}).click();
    await frame.locator('[data-presentation-key="conversation:composer"]').evaluate(element=>{element.scrollTop=0;});
    await frame.locator('.conversation-history').evaluate(element=>{element.scrollTop=0;});
    const composerViewport=await frame.locator('[data-presentation-key="conversation:composer"]').boundingBox();
    const historyRegion=frame.getByRole('region',{name:'会话历史',exact:true});
    await historyRegion.focus();await historyRegion.press('PageDown');
    await page.waitForTimeout(200);
    assert.ok(await historyRegion.evaluate(element=>element.scrollTop>0), 'focused history scrolls through the keyboard: ' + JSON.stringify(await historyRegion.evaluate(element => ({scrollTop:element.scrollTop,scrollHeight:element.scrollHeight,clientHeight:element.clientHeight,active:element.ownerDocument.activeElement?.outerHTML.slice(0,250),overflow:getComputedStyle(element).overflowY}))));
    await historyRegion.evaluate(element=>{element.scrollTop=0;});
    const composerBounds=await composer.boundingBox();
    assert.ok(composerBounds&&composerBounds.y>=0&&composerBounds.y+composerBounds.height<=900,'long history does not push the editor outside the viewport');
    assert.ok(await frame.locator('.conversation-history').evaluate(element=>element.scrollHeight>element.clientHeight),'history has an independent scroll viewport');
    const sendBounds=await frame.getByRole('button',{name:'发送',exact:true}).boundingBox();
    assert.ok(sendBounds&&sendBounds.y>=composerViewport.y&&sendBounds.y+sendBounds.height<=composerViewport.y+composerViewport.height,'send action remains visible before attachment details');
    const accessibility=await frame.locator('.conversation').ariaSnapshot();
    for(const label of ['main "会话"','region "会话历史"','textbox "消息"','button "发送"'])assert.ok(accessibility.includes(label),label);
    await writeFile('/tmp/aibo-full-'+pkg.release.manifest.id.split('.').at(-1)+'-accessibility.txt',accessibility);

    await page.screenshot({path:'/tmp/aibo-full-'+pkg.release.manifest.id.split('.').at(-1)+'.png',fullPage:true});
    await composer.focus();
    await composer.evaluate(element=>element.setSelectionRange(1,3));
    await frame.locator('[data-presentation-key="message-group:tool-group-tool-message"]').evaluate(element=>{
      const viewport=element.closest('.conversation-history');viewport.scrollTop+=element.getBoundingClientRect().top-viewport.getBoundingClientRect().top+12;
    });
    await page.waitForTimeout(50);
    await page.getByRole('button',{name:/^打开工作台设置/}).click();
    if (builtInKit === 'material3') await page.locator('.appearance-kit-option').filter({hasText:'Aibo · Material 3'}).click();
    else await page.getByRole('button',{name:'恢复内置皮肤',exact:true}).click();
    assert.equal(await page.locator('.app-shell').getAttribute('data-ui-kit'), builtInKit);
    assert.equal(await page.getByRole('button',{name:`调整工作区与会话宽度，当前 ${resized} 像素`,exact:true}).count(),1);
    await page.getByRole('button',{name:'关闭设置',exact:true}).click();
    const defaultComposer=page.locator('.presentation-fallback textarea[data-presentation-focus="composer"]');
    await defaultComposer.waitFor({state:'visible'});
    assert.deepEqual(await defaultComposer.evaluate(element=>[element===document.activeElement,element.selectionStart,element.selectionEnd]),[true,1,3]);
    const defaultAnchor=page.locator('[data-presentation-message="message-group:tool-group-tool-message"]');
    assert.ok(Math.abs(await defaultAnchor.evaluate(element=>element.getBoundingClientRect().top-element.closest('[data-presentation-timeline]').getBoundingClientRect().top)+12)<2,'external anchor maps into default message viewport');
    await defaultComposer.evaluate(element=>element.setSelectionRange(2,4));
    await page.locator('[data-presentation-message="message:scroll-10"]').evaluate(element=>{
      const viewport=element.closest('[data-presentation-timeline]');viewport.scrollTop+=element.getBoundingClientRect().top-viewport.getBoundingClientRect().top+18;
    });
    await page.waitForTimeout(50);
    await page.getByRole('button',{name:/^打开工作台设置/}).click();
    await page.getByRole('button',{name:pkg.release.manifest.displayName+' '+pkg.release.manifest.version,exact:true}).click();
    await page.getByRole('button',{name:'关闭设置',exact:true}).click();
    await frame.locator('.navigation').waitFor({state:'visible'});
    assert.equal(await frame.locator('.navigation').evaluate(element=>Math.round(element.getBoundingClientRect().width)),resized);
    await composer.waitFor();assert.equal(await composer.inputValue(),'换肤保留');
    await frame.locator('textarea:focus').waitFor({timeout:3000});
    assert.ok(Math.abs(await frame.locator('[data-presentation-key="message:scroll-10"]').evaluate(element=>element.getBoundingClientRect().top-element.closest('.conversation-history').getBoundingClientRect().top)+18)<2,'default anchor maps into external center viewport');
    assert.deepEqual(await composer.evaluate(element=>[element===document.activeElement,element.selectionStart,element.selectionEnd]),[true,2,4]);
    if(await frame.locator('[data-presentation-key="workbench:layout"]').getAttribute('open')===null)await frame.getByText('布局',{exact:true}).click();
    await frame.getByRole('button',{name:'审阅布局',exact:true}).click();
    await page.waitForFunction(()=>localStorage.getItem('aibo.workbench-presentation.v1.main')==='review');
    await frame.getByRole('button',{name:'侧边面板',exact:true}).click();
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('aibo.workbench-layout.v1.main')||'null')?.auxiliaryOpen===false);
    const savedLayout=await page.evaluate(()=>JSON.parse(localStorage.getItem('aibo.workbench-layout.v1.main')));
    const answerRequest={requestId:'reload-question',isBlocking:true,questions:[{id:'answer',header:null,question:'Persistent answer?',options:[],isOther:true}]};
    await page.evaluate(request=>window.emitAgent('user_input.requested',request),answerRequest);
    await frame.getByRole('textbox',{name:'Persistent answer?',exact:true}).fill('尚未提交的回答');
    await page.waitForFunction(()=>Object.values(JSON.parse(localStorage.getItem('aibo.answer-drafts.v1.main')||'{}').drafts??{}).includes('尚未提交的回答'));
    await page.reload();
    await frame.locator('.navigation').waitFor({state:'visible'});
    assert.equal(await frame.getByRole('textbox',{name:'Persistent answer?',exact:true}).count(),0);
    await page.evaluate(request=>window.emitAgent('user_input.requested',request),answerRequest);
    await frame.getByRole('textbox',{name:'Persistent answer?',exact:true}).waitFor();
    assert.equal(await frame.getByRole('textbox',{name:'Persistent answer?',exact:true}).inputValue(),'尚未提交的回答');
    await frame.getByRole('button',{name:'提交回答',exact:true}).click();
    await page.waitForFunction(()=>window.navigationCalls.some(call=>call.command==='resolve_agent_user_input'&&call.args.answers.answer?.[0]==='尚未提交的回答'));
    await page.waitForFunction(()=>!Object.values(JSON.parse(localStorage.getItem('aibo.answer-drafts.v1.main')||'{}').drafts??{}).includes('尚未提交的回答'));
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


    await page.getByRole('button',{name:/^打开工作台设置/}).click();
    if (builtInKit === 'material3') await page.locator('.appearance-kit-option').filter({hasText:'Aibo · Material 3'}).click();
    else await page.getByRole('button',{name:'恢复内置皮肤',exact:true}).click();
    assert.equal(await page.locator('.app-shell').getAttribute('data-ui-kit'), builtInKit);
    await page.getByRole('button',{name:'关闭设置',exact:true}).click();
  }
  const approvalChecks=await probePresentationApprovalFault(page);
  await writeFile('/tmp/aibo-presentation-approval-fault-browser.json',JSON.stringify({passed:true,browser:browser.version(),nativePort:'mocked; actual App, real Worker infinite loop, Playwright pointer input',checks:approvalChecks},null,2)+'\n');
  assert.deepEqual(errors,[]);
  const result={passed:true,nativePort:'mocked; actual App and independently built full skin Workers',browser:browser.version(),packages:built.packages.map(({release})=>({id:release.manifest.id,version:release.manifest.version,digest:release.digest})),checks:[...approvalChecks,'command filters are separate pressed buttons, editor controls only the option list, history supports PageDown','desktop history and composer scroll independently, send remains visible, named history and editor appear in the accessibility tree','ordinary message and tool group anchors transfer across different scroll containers','default and external composer focus and selection transfer in both directions','command category Tab and reverse Tab, mouse focus return, primary path confirmation','command and path keyboard completion, caret placement and Escape newline','answer draft reload waits for matching live request and clears after submit','focus and review modes, reversed drag, draft preservation and mode reload','reload restores both widths, panel visibility and selected view','both splitter drag directions and auxiliary keyboard resize','keyboard width adjustment and default/external width retention','primary Enter submits through host action','consecutive tool group with completion count','literal tool payloads and native reasoning disclosure in both skins','both full packages install and activate','workspace and session navigation','rich timeline headings, lists, inline and fenced code','host-bound code copy and link actions','attachment transport metadata hidden','rapid Chinese/English input and send','Git/context panel switching','requested and enforced permissions remain distinct','attachment status, strategy and size','diagnostic details remain visible','default/external switch retains host draft']};
  await writeFile('/tmp/aibo-full-skins-browser.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
} catch(error) {console.error(JSON.stringify({errors}));throw error;} finally {await browser.close();await server.close();await built.dispose();}
