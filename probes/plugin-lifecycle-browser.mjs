import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';

// Real App controls with substituted IPC; native persistence has separate Rust coverage.
const server=await createServer({server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false,watch:null}});
await server.listen();
const browser=await chromium.launch({headless:true});
try {
  for(const kitId of ['material3','ak-ui']) for(const themeId of ['light','dark']) {
    const page=await browser.newPage({viewport:{width:1280,height:900}});
    page.setDefaultTimeout(15000);
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(({kitId,themeId})=>{
      localStorage.setItem('aibo.appearance.v1',JSON.stringify({kitId,themeId}));
      let callback=0,removed=false,migrated=false,block=false;
      window.lifecycleCalls=[];window.blockDependency=()=>{block=true;};window.clearDependency=()=>{block=false;};
      const old={id:'old',pluginId:'third.party',pluginVersion:'1.0.0',installed:true,enabled:true,runnable:true,dependencies:[],contributions:[],manifest:{displayName:'Third Party'}};
      window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback(fn){const id=++callback;window['_'+id]=fn;return id;},unregisterCallback(id){delete window['_'+id];},async invoke(command,args={}){
        window.lifecycleCalls.push({command,args});
        if(command.startsWith('plugin:event|'))return 1;
        if(command==='get_app_snapshot')return {platform:'macos',appVersion:'probe',workspaceCount:0,diagnostics:[]};
        if(command==='list_plugin_installations')return removed?[]:[old];
        if(command==='preview_plugin_removal')return {id:'old',token:migrated?'after':'before',sessions:migrated?[]:[{id:'session-1',label:'Important history'}],bindings:migrated?[]:[{id:'candidate',label:'原文{contribution} · 候选绑定',localizedLabel:{schema:'aibo.host-message/v1',key:'native.plugin.candidateBinding',params:{contribution:'原文{contribution}'}}}],dependencies:block?[{id:'tool',label:'Dependent Tool'}]:[],active:0,targets:[{id:'new',label:'2.0.0'}]};
        if(command==='migrate_plugin_sessions'){if(window.migrationFailure)return {migrated:[],failed:[{id:'session-1',label:'原始迁移诊断',localizedLabel:{schema:'aibo.host-message/v1',key:'native.plugin.migrationFailed',params:{label:'原始会话 {label}',reason:{key:'native.plugin.identityChanged',params:{}}}}}]};migrated=true;return {migrated:['session-1'],failed:[]};}
        if(command==='uninstall_agent_plugin'){if(args.token!==(migrated?'after':'before'))throw Error('stale');removed=true;return;}
        if(command==='read_workspace_preferences')return {trustNewWorkspaces:true};
        if(command==='read_host_confirmation_preferences')return {git:'always-allow',projectAction:'always-allow',turnRestore:'always-allow',capabilityWrite:'always-allow',viewWrite:'always-allow'};
        if(command==='get_presentation_selection'||command==='get_turn_change_set')return null;
        return [];
      }};
    },{kitId,themeId});
    await page.addInitScript(()=>{if(window===window.top&&location.protocol==='http:')localStorage.setItem('aibo.language.v1','zh-CN')});
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
    await page.getByRole('button',{name:'插件与能力',exact:true}).click();
    const dialog=page.getByRole('dialog');
    await page.getByRole('dialog',{name:'工作台设置',exact:true}).waitFor();
    await dialog.getByRole('button',{name:'卸载插件',exact:true}).click();
    const impact=dialog.getByRole('region',{name:/^(卸载影响|Uninstallation impact)$/});
    await impact.getByText('会话：Important history（session-1）').waitFor();
    await impact.getByText('能力绑定：原文{contribution} · 候选绑定',{exact:true}).waitFor();
    const reads=await page.evaluate(()=>window.lifecycleCalls.filter(call=>call.command==='preview_plugin_removal').length);
    await page.evaluate(async()=>{const {language}=await import('/src/lib/i18n/runtime.ts');language.set({preference:'en',locale:'en'})});
    await impact.getByText('Capability binding: 原文{contribution} · candidate binding',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.lifecycleCalls.filter(call=>call.command==='preview_plugin_removal').length),reads);
    await page.evaluate(async()=>{const {language}=await import('/src/lib/i18n/runtime.ts');language.set({preference:'zh-CN',locale:'zh-CN'})});
    await impact.getByText('能力绑定：原文{contribution} · 候选绑定',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.lifecycleCalls.some(c=>c.command==='uninstall_agent_plugin')),false);
    await impact.getByRole('button',{name:'取消',exact:true}).click();
    await page.evaluate(()=>window.blockDependency());
    await dialog.getByRole('button',{name:'卸载插件',exact:true}).click();
    assert.equal(await impact.getByRole('button',{name:'保留历史并停用，清除插件数据',exact:true}).isDisabled(),true);
    await impact.getByRole('button',{name:'取消',exact:true}).click();
    await page.evaluate(()=>window.clearDependency());
    await dialog.getByRole('button',{name:'卸载插件',exact:true}).click();
    await page.evaluate(()=>window.migrationFailure=true);
    await impact.getByRole('button',{name:'迁移到 2.0.0',exact:true}).click();
    await dialog.getByText('原始会话 {label}：新版未恢复原会话，原绑定已保留',{exact:true}).waitFor();
    const migrations=await page.evaluate(()=>window.lifecycleCalls.filter(call=>call.command==='migrate_plugin_sessions').length);
    await page.evaluate(async()=>{const {language}=await import('/src/lib/i18n/runtime.ts');language.set({preference:'en',locale:'en'})});
    await dialog.getByText('原始会话 {label}: The new version did not restore the original session. The original binding was retained.',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.lifecycleCalls.filter(call=>call.command==='migrate_plugin_sessions').length),migrations);
    await page.evaluate(async()=>{const {language}=await import('/src/lib/i18n/runtime.ts');language.set({preference:'zh-CN',locale:'zh-CN'});window.migrationFailure=false;});
    await dialog.getByText('原始会话 {label}：新版未恢复原会话，原绑定已保留',{exact:true}).waitFor();
    await impact.getByRole('button',{name:'迁移到 2.0.0',exact:true}).click();
    await impact.getByRole('button',{name:'卸载并清除数据',exact:true}).waitFor();
    await page.setViewportSize({width:960,height:720});
    assert.equal(await dialog.locator('.management-content').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
    await page.screenshot({path:`/tmp/aibo-plugin-lifecycle-${kitId}-${themeId}.png`});
    await impact.getByRole('button',{name:'卸载并清除数据',exact:true}).click();
    await dialog.getByText('尚未安装外部插件。',{exact:true}).waitFor();
    const call=await page.evaluate(()=>window.lifecycleCalls.find(c=>c.command==='uninstall_agent_plugin'));
    assert.deepEqual(call.args,{id:'old',token:'after',keepHistory:false});
    assert.deepEqual(errors,[]);await page.close();
    console.log(`${kitId}/${themeId}: reference preview, cancel, dependency blocking, migration, refreshed confirmation and cleanup passed`);
  }
} finally {await browser.close();await server.close();}
