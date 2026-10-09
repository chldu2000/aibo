import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const catalogs=Object.fromEntries(['en','zh-CN'].map(locale=>[locale,JSON.parse(readFileSync(new URL(`../packages/i18n/locales/${locale}.json`,import.meta.url),'utf8'))]));
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
      let callback=0, failLogin=true, loggedIn=false;
      window.authenticationCalls=[];
      window.completeLogin=()=>{loggedIn=true;};
      const old={id:'third-release',pluginId:'third.party',pluginVersion:'1.0.0',installed:true,enabled:true,runnable:true,dependencies:[],contributions:[],manifest:{displayName:'Third Party',authentication:{kind:'cli-terminal',executable:'third-cli',loginArgs:['login'],statusArgs:['status']}}};
      const plain={...old,id:'plain',pluginId:'plain.agent',manifest:{displayName:'Plain Agent'}};
      window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback(fn){const id=++callback;window['_'+id]=fn;return id;},unregisterCallback(id){delete window['_'+id];},async invoke(command,args={}){
        window.authenticationCalls.push({command,args});
        if(command.startsWith('plugin:event|'))return 1;
        if(command==='get_app_snapshot')return {platform:'macos',appVersion:'probe',workspaceCount:0,diagnostics:[]};
        if(command==='list_plugin_installations')return [old,plain];
        if(command==='plugin_authentication_action'){
          if(window.nativeAuthKey)throw {message:'original authentication diagnostic',localized:{schema:'aibo.host-message/v1',key:window.nativeAuthKey,params:{}}};
          if(window.hostAuthFailure)throw {code:'workspace_trust_required',message:'original diagnostic',localized:{schema:'aibo.host-message/v1',key:'native.error.workspaceTrust',params:{}}};
          if(args.action==='status')return loggedIn?'authenticated':'unauthenticated';
          if(failLogin){failLogin=false;throw Error('无法打开登录终端');}
          return 'loginOpened';
        }
        if(command==='set_agent_plugin_enabled'){old.enabled=args.enabled;return {migrated:[],failed:[]};}
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
    await dialog.getByRole('button',{name:'检查登录状态',exact:true}).click();
    await dialog.getByText('尚未登录或授权未完成，请点击“登录 / 授权”。',{exact:true}).waitFor();
    await dialog.getByRole('button',{name:'登录 / 授权',exact:true}).click();
    await dialog.getByRole('alert').filter({hasText:'无法打开登录终端'}).waitFor();
    await dialog.getByRole('button',{name:'登录 / 授权',exact:true}).click();
    await dialog.getByText('已打开登录终端，请完成浏览器授权，再点击“检查登录状态”。',{exact:true}).waitFor();
    assert.equal(await dialog.getByRole('alert').count(),0);
    await page.evaluate(()=>window.completeLogin());
    await dialog.getByRole('button',{name:'检查登录状态',exact:true}).click();
    await dialog.getByText(/CLI 报告已登录/).waitFor();
    await dialog.getByRole('button',{name:'禁用插件',exact:true}).click();
    await dialog.getByText('启用插件后可登录或检查状态。',{exact:true}).waitFor();
    assert.equal(await dialog.getByRole('button',{name:'登录 / 授权',exact:true}).isDisabled(),true);
    await dialog.getByRole('button',{name:'Plain Agent · 1.0.0',exact:true}).click();
    assert.equal(await dialog.getByRole('button',{name:'登录 / 授权',exact:true}).count(),0);
    await dialog.getByRole('button',{name:'Third Party · 1.0.0',exact:true}).click();
    await page.setViewportSize({width:960,height:720});
    assert.equal(await dialog.locator('.management-content').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
    await page.screenshot({path:`/tmp/aibo-plugin-authentication-${kitId}-${themeId}.png`});
    const calls=await page.evaluate(()=>window.authenticationCalls.filter(c=>c.command==='plugin_authentication_action'));
    assert.deepEqual(calls.map(c=>c.args),['status','login','login','status'].map(action=>({id:'third-release',action})));
    await dialog.getByRole('button',{name:'启用插件',exact:true}).click();
    await page.evaluate(()=>window.hostAuthFailure=true);
    await dialog.getByRole('button',{name:'登录 / 授权',exact:true}).click();
    await page.getByRole('alert').filter({hasText:'此操作需要可信工作区。请先确认工作区可信。'}).waitFor();
    const beforeSwitch=await page.evaluate(()=>window.authenticationCalls.filter(call=>call.command==='plugin_authentication_action').length);
    await page.evaluate(async()=>{const {language}=await import('/src/lib/i18n/runtime.ts');language.set({preference:'en',locale:'en'})});
    await page.getByRole('alert').filter({hasText:'This operation requires a trusted workspace. Confirm workspace trust first.'}).waitFor();
    assert.equal(await page.evaluate(()=>window.authenticationCalls.filter(call=>call.command==='plugin_authentication_action').length),beforeSwitch);
    await page.evaluate(async()=>{const {language}=await import('/src/lib/i18n/runtime.ts');language.set({preference:'zh-CN',locale:'zh-CN'})});
    await page.getByRole('alert').filter({hasText:'此操作需要可信工作区。请先确认工作区可信。'}).waitFor();
    await page.evaluate(()=>window.hostAuthFailure=false);
    for(const key of Object.keys(catalogs.en).filter(key=>key.startsWith('native.authentication.')||['native.manifest.schemaValidation','native.manifest.authenticationDependency'].includes(key))) {
      await page.evaluate(key=>window.nativeAuthKey=key,key);
      await dialog.getByRole('button',{name:'检查登录状态',exact:true}).click();
      await dialog.getByRole('alert').filter({hasText:catalogs['zh-CN'][key]}).waitFor();
      const before=await page.evaluate(()=>window.authenticationCalls.filter(call=>call.command==='plugin_authentication_action').length);
      await page.evaluate(async()=>{const {language}=await import('/src/lib/i18n/runtime.ts');language.set({preference:'en',locale:'en'})});
      await dialog.getByRole('alert').filter({hasText:catalogs.en[key]}).waitFor();
      await dialog.getByRole('button',{name:'Third Party · 1.0.0',exact:true}).waitFor();
      assert.equal(await page.evaluate(()=>window.authenticationCalls.filter(call=>call.command==='plugin_authentication_action').length),before);
      await page.evaluate(async()=>{const {language}=await import('/src/lib/i18n/runtime.ts');language.set({preference:'zh-CN',locale:'zh-CN'})});
      await dialog.getByRole('alert').filter({hasText:catalogs['zh-CN'][key]}).waitFor();
      assert.equal(await page.evaluate(()=>window.authenticationCalls.filter(call=>call.command==='plugin_authentication_action').length),before);
    }
    await page.evaluate(()=>window.nativeAuthKey='');
    await dialog.getByRole('button',{name:'检查登录状态',exact:true}).click();
    await dialog.getByText(/CLI 报告已登录/).waitFor();
    assert.equal(await dialog.getByRole('alert').count(),0);
    assert.deepEqual(errors,[]);await page.close();
    console.log(`${kitId}/${themeId}: authentication entry, failure/retry, status, disabled and unsupported providers passed`);
  }
} finally {await browser.close();await server.close();}
