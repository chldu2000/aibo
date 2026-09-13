import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const bytes=Buffer.from("self.aiboPresentation={render(input){return {tag:'main',key:'main',children:[{tag:'h1',key:'heading',text:'External background'},{tag:'textarea',key:'draft',attrs:{'aria-label':'External draft',value:input.data.draft||''},events:{input:'draft'}}]}}};");
const pkg={release:{digest:'a'.repeat(64),enabled:true,manifest:{schema:'aibo.presentation-package/v1',id:'dev.example.panel',version:'1.0.0',displayName:'Panel probe',hostApi:'1.0.0',coreSemantics:'1.0.0',snapshotSchemas:['aibo.semantic-view/v1'],entry:'skin.js',surfaces:['workbench'],resources:[{path:'skin.js',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),mediaType:'text/javascript'}]}},resources:{'skin.js':bytes.toString('base64')}};
const server = await createServer({server:{host:'127.0.0.1',port:0,hmr:false,watch:null}});
await server.listen();
const browser = await chromium.launch({headless:true});
try {
  for (const kit of ['shadcn','material3','external']) {
    const page = await browser.newPage({viewport:{width:1280,height:900}});
    page.setDefaultTimeout(10000);
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(({kit,pkg})=>{
      if(window!==window.top)return;
      localStorage.setItem('aibo.appearance.v1',JSON.stringify({kitId:kit,themeId:kit==='material3'?'sage':'graphite'}));
      let callback=0, agentHandler=null, sequence=0;
      window.approvalDecisions=[];
      window.emitApproval=()=>window['_'+agentHandler]({event:'agent-event',id:1,payload:{schemaVersion:'2.0',eventId:'approval:'+ ++sequence,generationId:'generation',sequence,occurredAt:new Date().toISOString(),source:{pluginId:'dev.example.provider',pluginVersion:'1.0.0'},workspaceId:'w1',sessionId:'s1',turnId:'turn',type:'approval.requested',payload:{requestId:'panel-approval',kind:'command',command:'echo approval',availableDecisions:['accept','cancel']}}});
      const workspace={id:'w1',label:'Panel test',path:'/probe/w1',trust:'trusted',createdAt:'2026-09-14',updatedAt:'2026-09-14',lastOpenedAt:null};
      const installations=['Alpha','Beta'].map((name,i)=>({id:`p${i}`,pluginId:`test.${name.toLowerCase()}`,pluginVersion:'1.0.0',enabled:false,installed:true,runnable:true,dependencies:[],contributions:[],manifest:{displayName:name}}));
      window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},
        transformCallback(fn){const id=++callback;window['_'+id]=fn;return id;},unregisterCallback(id){delete window['_'+id];},
        async invoke(command,args={}){
          if(command==='plugin:event|listen'){if(args.event==='agent-event')agentHandler=args.handler;return 1;}
          if(command==='resolve_agent_approval'){window.approvalDecisions.push(args);return;}
          if(command.startsWith('plugin:event|'))return 1;
          if(command==='get_app_snapshot')return {platform:'macos',appVersion:'probe',workspaceCount:1,diagnostics:[]};
          if(command==='list_workspaces')return [workspace];
          if(command==='list_plugin_installations')return installations;
          if(command==='get_presentation_selection')return kit==='external'?{digest:pkg.release.digest,themeId:null}:null;
          if(command==='list_presentation_packages')return kit==='external'?[pkg.release]:[];
          if(command==='read_presentation_package')return pkg;
          if(command==='inspect_workspace_capabilities')return {workspaceId:'w1',inspectedAt:'now',instructions:[],skills:[],tools:[],mcpServers:[],warnings:[]};
          if(command==='get_workspace_changes')return {workspaceId:'w1',head:'head',branch:'main',dirty:false,files:[],captureStatus:'captured'};
          if(command==='list_project_action_runs')return Array.from({length:21},(_,i)=>({id:`run${args.before?'old':''}${i}`,workspaceId:'w1',actionId:'test',actionName:`Task ${i}`,status:'completed',startedAt:new Date(Date.UTC(2026,8,args.before?12:14,0,0,59-i)).toISOString(),completedAt:'2026-09-14T01:00:00Z',output:'probe output\n'.repeat(50)}));
          if(command==='list_capability_history_scopes')return {schema:'aibo.capability-history-scopes/v1',source:'events',scopes:[],nextBefore:null};
          return [];
        }};
    },{kit,pkg});
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
    if(kit==='external'){await page.frameLocator('.presentation-external iframe').getByRole('textbox',{name:'External draft'}).fill('Keep my draft');await page.evaluate(()=>{window.originalFrame=document.querySelector('.presentation-external iframe');});}
    const plugins=page.locator('[data-host-navigation="plugins"]');
    await plugins.click();
    const panel=page.locator('[data-ui-component="host-panel"]');
    await panel.waitFor();
    await page.getByRole('button',{name:'Beta · 1.0.0',exact:true}).click();
    assert.equal(await page.getByRole('heading',{name:'Beta',exact:true}).count(),1);
    const bounds=await panel.boundingBox();
    assert.ok(bounds.width<=1002 && bounds.x>50 && bounds.y>40);
    assert.ok(await page.locator(kit==='external'?'.presentation-external iframe':'.workspace-grid').isVisible());
    if(kit==='external')assert.equal(await page.locator('.presentation-external').getAttribute('inert'),'');
    assert.equal(await page.locator('.workbench-presentation').getAttribute('inert'),'');
    await page.evaluate(()=>window.emitApproval());
    const approval=page.getByRole('region',{name:'宿主审批'});
    await approval.getByRole('button',{name:'允许',exact:true}).waitFor();
    const controls=panel.locator('button:visible:not([disabled]),input:visible:not([disabled]),textarea:visible:not([disabled])');
    await controls.last().focus();
    await page.keyboard.press('Tab');
    assert.ok(await approval.evaluate(el=>el.contains(document.activeElement)), 'Tab reaches host approvals');
    await approval.getByRole('button',{name:'允许',exact:true}).click();
    assert.deepEqual(await page.evaluate(()=>window.approvalDecisions),[{sessionId:'s1',requestId:'panel-approval',decision:'accept'}]);
    await page.screenshot({path:`/tmp/aibo-host-plugins-${kit}.png`});
    await page.setViewportSize({width:480,height:780});
    await page.getByRole('button',{name:'← 插件列表',exact:true}).click();
    await page.getByRole('button',{name:'Alpha · 1.0.0',exact:true}).click();
    assert.ok(await page.getByRole('heading',{name:'Alpha',exact:true}).isVisible());
    assert.ok((await panel.boundingBox()).width<=480);
    assert.equal(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth),true);
    await page.screenshot({path:`/tmp/aibo-host-plugins-narrow-${kit}.png`});
    await page.keyboard.press('Escape');
    try { await panel.waitFor({state:'detached'}); } catch(error) { console.log({kit,errors,active:await page.evaluate(()=>document.activeElement?.outerHTML),body:await page.locator('body').innerText()}); throw error; }
    assert.equal(await plugins.evaluate(el=>el===document.activeElement),true);
    if(kit==='external'){assert.equal(await page.evaluate(()=>window.originalFrame===document.querySelector('.presentation-external iframe')),true);assert.equal(await page.frameLocator('.presentation-external iframe').getByRole('textbox',{name:'External draft'}).inputValue(),'Keep my draft');}
    await page.setViewportSize({width:1280,height:900});
    const diagnostics=page.getByRole('button',{name:'打开 Agent 诊断',exact:true});
    await diagnostics.click();
    try { await panel.waitFor(); } catch (error) { console.log({errors,body:await page.locator('body').innerText()}); throw error; }
    await page.getByRole('button',{name:'执行历史',exact:true}).click();
    await page.getByRole('button',{name:'更早一页',exact:true}).click();
    await page.getByText('第 2 页',{exact:true}).waitFor();
    const details=page.locator('.host-history-region details').first();
    assert.equal(await details.getAttribute('open'),null);
    await details.locator('summary').click();
    assert.ok(await details.locator('textarea').isVisible());
    await page.evaluate(()=>{window.historyNode=document.querySelector('.host-history-region');});
    // Put the audit entry in view while retaining a nonzero content scroll position.
    await page.locator('.host-panel-body').evaluate(el=>{el.scrollTop=80;});
    await page.waitForFunction(()=>document.querySelector('.host-panel-body').scrollTop===80);
    await page.getByRole('button',{name:'插件调用历史',exact:true}).click();
    await page.getByRole('button',{name:'← 执行历史',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.historyNode===document.querySelector('.host-history-region')),true);
    assert.ok(await page.getByText('第 2 页',{exact:true}).isVisible());
    assert.equal(await details.getAttribute('open'),'');
    await page.waitForFunction(()=>document.querySelector('.host-panel-body').scrollTop===80);
    await page.keyboard.press('Control+k');
    await page.locator('#command-palette-input').waitFor();
    await page.keyboard.press('Escape');
    assert.ok(await panel.isVisible());
    await page.screenshot({path:`/tmp/aibo-host-history-${kit}.png`});
    await page.getByRole('button',{name:'← 诊断',exact:true}).click();
    await page.getByRole('button',{name:'关闭Agent 诊断',exact:true}).waitFor();
    await page.keyboard.press('Escape');
    try { await panel.waitFor({state:'detached'}); } catch(error) { console.log({kit,errors,active:await page.evaluate(()=>document.activeElement?.outerHTML),body:await page.locator('body').innerText()}); throw error; }
    assert.equal(await diagnostics.evaluate(el=>el===document.activeElement),true);
    assert.deepEqual(errors,[]);
    await page.close();
    console.log(`${kit}: centered panels, narrow navigation, retained history, folding, background, approvals and focus passed`);
  }
} finally { await browser.close(); await server.close(); }
