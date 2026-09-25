import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { buildPresentationSkins } from './lib/build-presentation-skins.mjs';
const built = await buildPresentationSkins();
const server = await createServer({server:{host:'127.0.0.1',port:0,hmr:false,watch:null}}); await server.listen();
const browser = await chromium.launch({headless:true});
try {
  for (const [theme,pkg] of [['light',null],['dark',null],['light',built.packages[0]],['dark',built.packages[1]]]) {
    const page = await browser.newPage({viewport:{width:1280,height:900}}); page.setDefaultTimeout(12000);
    const errors=[];page.on('pageerror',error=>errors.push(error.stack??error.message));
    await page.addInitScript(({theme,pkg})=>{
      if(window!==window.top)return;
      localStorage.setItem('aibo.appearance.v1',JSON.stringify({kitId:'ak-ui',themeId:theme}));
      const workspaces=['w1','w2'].map(id=>({id,path:'/probe/'+id,label:id==='w1'?'当前工程':'其他工程',trust:'trusted',createdAt:'2026-09-25',updatedAt:'2026-09-25',lastOpenedAt:null}));
      const sessions=[{id:'s1',workspaceId:'w1',agent:'fixture',label:'当前会话',state:'idle',archived:false,createdAt:'2026-09-25',updatedAt:'2026-09-25',capabilities:[],pluginInstallationId:null},{id:'s2',workspaceId:'w2',agent:'disabled',label:'归档搜索会话',state:'closed',archived:true,createdAt:'2026-09-24',updatedAt:'2026-09-24',capabilities:[],pluginInstallationId:null}];
      const item={id:'message:m',kind:'message',title:'assistant',description:'其他工程 · 归档搜索会话 · 已归档',excerpt:'中文连续正文中的搜索命中',target:{source:'message',id:'m',workspaceId:'w2',sessionId:'s2'},score:50};
      let callback=0;window.searchCalls=[];
      window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback(fn){const id=++callback;window['_'+id]=fn;return id;},unregisterCallback(id){delete window['_'+id];},async invoke(command,args={}){
        window.searchCalls.push({command,args});
        if(command.startsWith('plugin:event|'))return 1;
        if(command==='get_app_snapshot')return {platform:'macos',appVersion:'probe',workspaceCount:2,diagnostics:[]};
        if(command==='list_workspaces')return workspaces;
        if(command==='list_sessions')return sessions.filter(session=>session.workspaceId===args.workspaceId);
        if(command==='get_presentation_selection')return pkg?{digest:pkg.release.digest,themeId:null}:null;
        if(command==='list_presentation_packages')return pkg?[pkg.release]:[];
        if(command==='read_presentation_package')return pkg;
        if(command==='get_composer_draft'||command==='get_turn_change_set')return null;
        if(command==='search_global'){
          if(args.request.query==='slow')await new Promise(resolve=>setTimeout(resolve,500));
          return {items:args.request.query.includes('正文')?[item]:[],hasMore:false,warnings:[]};
        }
        if(command==='search_global_files'||command==='search_global_assets')return {items:[],hasMore:false,warnings:[]};
        if(command==='cancel_global_file_search')return;
        if(command==='read_search_result')return {title:'命中消息',content:'中文连续正文中的搜索命中',target:item.target,truncated:false};
        if(command==='read_session_history'||command==='read_session_history_around')return {schema:'aibo.session-history-page/v1',source:'persisted-core',session:sessions.find(session=>session.id===args.sessionId),items:[{id:'m',sessionId:args.sessionId,turnId:null,role:'assistant',toolName:null,content:'中文连续正文中的搜索命中',status:'completed',createdAt:'2026-09-24',updatedAt:'2026-09-24'}],nextBefore:null};
        if(command==='inspect_workspace_capabilities')return {workspaceId:args.workspaceId,inspectedAt:'now',instructions:[],skills:[],tools:[],mcpServers:[],warnings:[]};
        if(command==='get_workspace_changes')return {workspaceId:args.workspaceId,head:null,branch:null,dirty:false,files:[],captureStatus:'captured'};
        if(command==='list_workspace_git_repositories')return {repositories:[],limited:false,warnings:[]};
        if(command==='read_workspace_preferences')return {trustNewWorkspaces:true};
        return [];
      }};
    },{theme,pkg});
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
    await page.getByRole('button',{name:'全局搜索',exact:true}).waitFor();
    if(pkg)await page.locator('.presentation-external iframe:visible').waitFor();
    assert.equal(await page.locator('[data-ui-component="workspace-sidebar"]').getByRole('button',{name:'搜索会话',exact:true}).count(),0);
    await page.keyboard.press('Shift');await page.keyboard.press('Shift');
    const dialog=page.getByRole('dialog',{name:'全局搜索',exact:true});await dialog.waitFor();
    const input=page.getByRole('combobox',{name:'全局搜索内容'});
    assert.equal(await input.evaluate(el=>el===document.activeElement),true);
    const categories=dialog.locator('.global-search-categories');
    const labels=['全部','工作区','会话','消息','文件','命令','设置','插件','附件','产物','执行记录'];
    const selectedKind=()=>categories.locator('[aria-pressed="true"]').innerText();
    await input.fill('类型轮换');
    for(const label of [...labels.slice(1),labels[0]]){
      await page.keyboard.press('Tab');
      assert.equal(await selectedKind(),label);
      assert.equal(await input.inputValue(),'类型轮换');
      assert.equal(await input.evaluate(el=>el===document.activeElement),true);
    }
    for(const label of [...labels.slice(1).reverse(),labels[0]]){
      await page.keyboard.press('Shift+Tab');
      assert.equal(await selectedKind(),label);
    }
    await input.fill('> 类型轮换');await page.keyboard.press('Tab');
    assert.equal(await selectedKind(),'设置');assert.equal(await input.inputValue(),'类型轮换');
    await input.fill('@ 类型轮换');await page.keyboard.press('Shift+Tab');
    assert.equal(await selectedKind(),'工作区');
    for(const modifiers of [{isComposing:true},{ctrlKey:true},{altKey:true},{metaKey:true}]){
      const prevented=await input.evaluate((el,modifiers)=>!el.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true,...modifiers})),modifiers);
      assert.equal(prevented,false);assert.equal(await selectedKind(),'工作区');
    }
    await categories.getByRole('button',{name:'工作区',exact:true}).focus();
    await page.keyboard.press('Tab');assert.equal(await selectedKind(),'会话');
    assert.equal(await input.evaluate(el=>el===document.activeElement),true);
    await categories.getByRole('button',{name:'全部',exact:true}).click();
    await input.fill('正文');await dialog.getByRole('option').filter({hasText:'中文连续正文'}).waitFor();
    await page.keyboard.press('Enter');await dialog.getByRole('region',{name:'搜索结果详情'}).waitFor();
    await dialog.getByRole('button',{name:'← 搜索结果',exact:true}).focus();await page.keyboard.press('Tab');
    assert.equal(await dialog.getByRole('button',{name:'打开所属会话'}).evaluate(el=>el===document.activeElement),true);
    assert.equal(await selectedKind(),'全部');
    await dialog.getByRole('button',{name:'打开所属会话'}).click();
    await page.locator('#history-message-m[data-search-hit="true"]').waitFor();
    assert.ok(await page.evaluate(()=>window.searchCalls.some(call=>call.command==='read_session_history_around'&&call.args.messageId==='m'&&call.args.sessionId==='s2')));
    assert.ok(!await page.evaluate(()=>window.searchCalls.some(call=>call.command==='resume_agent_session'||call.command==='send_agent_prompt')));
    await page.getByRole('button',{name:'返回工作台'}).click();
    await page.getByRole('button',{name:'全局搜索',exact:true}).click();
    await input.fill('slow');await page.waitForTimeout(160);await input.fill('正文');
    await dialog.getByRole('option').filter({hasText:'中文连续正文'}).waitFor();await page.waitForTimeout(550);
    assert.equal(await dialog.getByRole('option').filter({hasText:'中文连续正文'}).count(),1);
    await dialog.getByRole('combobox',{name:'搜索范围'}).selectOption('w2');
    await page.waitForFunction(()=>window.searchCalls.some(call=>call.command==='search_global'&&call.args.request.workspaceId==='w2'));
    await input.focus();await page.keyboard.press('Tab');
    await page.waitForFunction(()=>window.searchCalls.some(call=>call.command==='search_global'&&call.args.request.workspaceId==='w2'&&call.args.request.kind==='workspace'&&call.args.request.query==='正文'));
    assert.equal(await dialog.getByRole('combobox',{name:'搜索范围'}).inputValue(),'w2');
    await page.keyboard.press('Shift+Tab');assert.equal(await selectedKind(),'全部');
    await page.screenshot({path:`/tmp/aibo-search-${theme}-${pkg?.release.manifest.id??'builtin'}.png`});
    await page.setViewportSize({width:680,height:740});
    assert.ok((await dialog.boundingBox()).width<=648);
    assert.equal(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth),true);
    await input.fill('> 打开工作台设置');await dialog.getByRole('option').filter({hasText:'打开工作台设置'}).waitFor();await page.keyboard.press('Enter');
    await page.getByRole('dialog',{name:'工作台设置',exact:true}).waitFor();
    await page.keyboard.press('Escape');
    // A real trusted keyboard event inside the isolated external workbench reaches the fixed host.
    if(pkg){
      const frame=page.frameLocator('.presentation-external iframe:visible');
      const button=frame.getByRole('button').first();await button.focus();
      await page.keyboard.press('Shift');await page.keyboard.press('Shift');await dialog.waitFor();
      await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});
      await button.focus();await page.keyboard.press('Control+k');await dialog.waitFor();
      await page.keyboard.press('Escape');
      await dialog.waitFor({state:'detached'});
    }
    await page.getByRole('button',{name:'全局搜索',exact:true}).focus();
    await page.keyboard.press('Shift+A');await page.keyboard.press('Shift');
    assert.equal(await dialog.count(),0);
    await page.keyboard.press('Control+k');await dialog.waitFor();await page.keyboard.press('Escape');
    await dialog.waitFor({state:'detached'});
    assert.equal(await page.getByRole('button',{name:'全局搜索',exact:true}).evaluate(el=>el===document.activeElement),true);
    assert.deepEqual(errors,[]);await page.close();console.log(`${theme} ${pkg?.release.manifest.displayName??'ak-ui'}: Tab type cycling, shortcuts, scopes, race, history anchor, command activation, narrow layout, focus passed`);
  }
} finally {await browser.close();await server.close();await built.dispose();}
