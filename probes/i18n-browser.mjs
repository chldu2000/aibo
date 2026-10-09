import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const server = await createServer({server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false,watch:null}});
await server.listen();
const browser = await chromium.launch({headless:true});
try {
  for (const kit of ['material3','ak-ui']) for (const theme of ['light','dark']) {
    const context = await browser.newContext({locale:'en-US',viewport:{width:1100,height:760}});
    const errors = [];
    context.on('page', page => { page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message)); });
    await context.addInitScript(({kit,theme}) => {
      if (window !== window.top || location.protocol !== 'http:') return;
      if (!localStorage.getItem('aibo.language.v1')) localStorage.setItem('aibo.language.v1', 'zh-CN');
      localStorage.setItem('aibo.appearance.v1', JSON.stringify({kitId:kit,themeId:theme}));
      const descriptor = {schema:'aibo.agent-settings/v1',version:1,title:'Third-party settings',scopes:['application','workspace'],fields:[{key:'instructions',label:'附加指令',type:'multiline',default:'Default instructions'}]};
      const contribution = {id:'third.party.agent',kind:'capabilityProvider',scope:'session',metadata:{displayName:'Third Party',settings:descriptor,operations:[]}};
      const installation = {id:'third-party-release',pluginId:'third.party',pluginVersion:'1.0.0',installed:true,enabled:false,runnable:true,dependencies:[],contributions:[contribution],manifest:{displayName:'Third Party'}};
      const workspace = {id:'w1',label:'Settings project',path:'/probe/settings',trust:'trusted',createdAt:'2026-09-24',updatedAt:'2026-09-24',lastOpenedAt:null};
      let callback = 0, trusted = true;
      const saved = {};
      window.settingsCalls = [];
      window.__TAURI_INTERNALS__ = {metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback(fn){const id=++callback;window['_'+id]=fn;return id;},unregisterCallback(id){delete window['_'+id];},async invoke(command,args={}){
        window.settingsCalls.push({command,args});
        if(command.startsWith('plugin:event|'))return 1;
        if(command==='get_app_snapshot')return {platform:'macos',appVersion:'probe',workspaceCount:1,diagnostics:[]};
        if(command==='list_workspaces')return [workspace];
        if(command==='list_plugin_installations')return [installation];
        if(command==='read_host_confirmation_preferences')return {git:'always-allow',projectAction:'always-allow',turnRestore:'always-allow',capabilityWrite:'always-allow',viewWrite:'always-allow'};
        if(command==='read_workspace_preferences')return {trustNewWorkspaces:trusted};
        if(command==='save_workspace_preferences'){trusted=args.trustNewWorkspaces;return {trustNewWorkspaces:trusted};}
        if(command==='get_presentation_selection'||command==='get_turn_change_set')return null;
        if(command==='read_agent_settings'||command==='save_agent_settings'){
          const target=args.target??args.request;
          const key=JSON.stringify(target.scope);
          if(command==='save_agent_settings')saved[key]={...target.values};
          const inheritedValues={instructions:target.scope.kind==='workspace'?(saved[JSON.stringify({kind:'application'})]?.instructions??'Default instructions'):'Default instructions'};
          return {target,descriptor,revision:0,values:saved[key]??{},inheritedValues,effectiveValues:{...inheritedValues,...saved[key]}};
        }
        if(command==='get_workspace_changes')return {workspaceId:'w1',head:null,branch:null,dirty:false,files:[],captureStatus:'captured'};
        if(command==='list_workspace_git_repositories')return {repositories:[],limited:false,warnings:[]};
        if(command==='get_workspace_git_remote_status')return {branch:null,upstream:null,ahead:0,behind:0};
        if(command==='inspect_workspace_capabilities')return {workspaceId:'w1',inspectedAt:'now',instructions:[],skills:[],tools:[],mcpServers:[],warnings:[]};
        return [];
      }};
    }, {kit,theme});
    const page = await context.newPage();
    const url = `http://127.0.0.1:${server.httpServer.address().port}/`;
    await page.goto(url);
    await page.getByRole('button',{name:'工作台设置',exact:true}).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('tab',{name:'插件与能力',exact:true}).click();
    await dialog.getByRole('button',{name:'设置 · Third Party',exact:true}).click();
    await dialog.getByRole('textbox',{name:'附加指令',exact:true}).fill('Keep this unsaved draft 中文');
    await dialog.getByRole('tab',{name:'外观',exact:true}).click();
    await dialog.getByRole('radio',{name:'English',exact:true}).check();
    await page.getByRole('dialog',{name:'Workbench settings',exact:true}).waitFor();
    assert.equal(await page.locator('html').getAttribute('lang'),'en');
    await page.waitForFunction(()=>window.settingsCalls.some(call=>call.command==='set_window_locale'&&call.args.locale==='en'));
    assert.deepEqual(await dialog.getByRole('tab').allInnerTexts(),['Appearance','Layout','Workspace','Plugins and capabilities','Runtime and diagnostics']);
    assert.equal(await dialog.getByRole('radio',{name:'English',exact:true}).isChecked(),true);
    await dialog.getByRole('tab',{name:'Plugins and capabilities',exact:true}).click();
    assert.equal(await dialog.getByRole('textbox',{name:'附加指令',exact:true}).inputValue(),'Keep this unsaved draft 中文');
    assert.equal(await page.evaluate(()=>window.settingsCalls.filter(c=>c.command==='save_agent_settings').length),0);
    assert.equal(await page.locator('.app-shell').getAttribute('data-ui-theme'),theme);
    await dialog.getByRole('tab',{name:'Appearance',exact:true}).click();
    await page.setViewportSize({width:800,height:720});
    await page.screenshot({path:`/tmp/aibo-i18n-${kit}-${theme}-en.png`});
    const second = await context.newPage();
    await second.goto(url);
    await second.getByRole('button',{name:'Workbench settings',exact:true}).click();
    assert.equal(await second.locator('html').getAttribute('lang'),'en');
    await dialog.getByRole('radio',{name:'简体中文',exact:true}).check();
    await second.getByRole('dialog',{name:'工作台设置',exact:true}).waitFor();
    assert.equal(await second.locator('html').getAttribute('lang'),'zh-CN','storage event synchronizes another window');
    await page.reload();
    await page.getByRole('button',{name:'工作台设置',exact:true}).click();
    assert.equal(await page.getByRole('radio',{name:'简体中文',exact:true}).isChecked(),true,'reload preserves explicit preference');
    await page.getByRole('radio',{name:'跟随系统',exact:true}).check();
    await page.getByRole('dialog',{name:'Workbench settings',exact:true}).waitFor();
    assert.equal(await page.locator('html').getAttribute('lang'),'en','system preference resolves navigator.languages');
    assert.deepEqual(errors,[]);
    await context.close();
    console.log(`i18n ${kit} ${theme}: switching, draft preservation, restart and cross-window sync passed`);
  }
} finally {
  await browser.close();
  await server.close();
}
