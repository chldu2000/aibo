import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const kit = process.env.AIBO_PROBE_UI_KIT ?? 'ak-ui';
// Real App and host dialog; native persistence is substituted at the IPC boundary.
const server = await createServer({server:{host:'127.0.0.1',port:0,hmr:false,watch:null}});
await server.listen();
const browser = await chromium.launch({headless:true});
try {
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({viewport:{width:1280,height:900}});
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({theme, kit}) => {
      if (window !== window.top) return;
      localStorage.setItem('aibo.language.v1', 'zh-CN');
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
          if(command==='read_agent_settings'&&window.settingsReadErrorKey)throw {message:'settings_unavailable: 配置存储不可用',localized:{schema:'aibo.host-message/v1',key:window.settingsReadErrorKey,params:{}}};
          if(command==='save_agent_settings'&&window.settingsErrorKey)throw {message:'settings_conflict: 原始诊断',localized:{schema:'aibo.host-message/v1',key:window.settingsErrorKey,params:{}}};
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
    }, {theme, kit});
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
    const trigger = page.getByRole('button',{name:'工作台设置',exact:true});
    await trigger.click();
    await page.getByRole('dialog',{name:'工作台设置',exact:true}).waitFor();
    const dialog = page.getByRole('dialog');
    const tab = name => dialog.getByRole('tab',{name,exact:true});
    const selected = async name => assert.equal(await tab(name).getAttribute('aria-selected'),'true');
    assert.equal(await page.getByRole('dialog').count(),1);
    assert.deepEqual(await dialog.getByRole('tab').allInnerTexts(),['外观','布局','工作区','插件与能力','运行与诊断']);
    await selected('外观');
    assert.equal(await dialog.getByRole('radiogroup',{name:kit === 'ak-ui' ? '主题' : '明暗模式',exact:true}).getByRole('radio').count(),2);
    assert.equal(await dialog.getByRole('radiogroup',{name:'界面语言'}).getByRole('radio').count(),3);
    const languageOptions = dialog.locator('[aria-labelledby="language-title"] .appearance-mode-option');
    const checkLanguageLayout = async () => {
      for (const option of await languageOptions.all()) {
        const geometry = await option.evaluate(el => {
          const mark = el.querySelector('.appearance-choice-mark').getBoundingClientRect();
          const label = el.lastElementChild.getBoundingClientRect();
          const bounds = el.getBoundingClientRect();
          return {offset: mark.height ? Math.abs(mark.y + mark.height / 2 - label.y - label.height / 2) : 0, height: bounds.height,
            contained: label.right <= bounds.right && label.left >= bounds.left};
        });
        assert.ok(geometry.offset <= 1, 'language checkmark and text are vertically aligned');
        assert.ok(geometry.height >= (kit === 'ak-ui' ? 44 : 40) && geometry.contained, 'language options have reachable targets and contained text');
      }
    };
    await checkLanguageLayout();
    const languageRadio = value => dialog.locator(`input[name="interface-language"][value="${value}"]`);
    await languageRadio('en').click();
    await dialog.getByRole('heading',{name:'Interface language',exact:true}).waitFor();
    await checkLanguageLayout();
    assert.equal(await languageRadio('en').isChecked(),true);
    await languageRadio('en').focus();
    await page.keyboard.press('ArrowLeft');
    assert.equal(await languageRadio('zh-CN').isChecked(),true);
    assert.equal(await languageRadio('zh-CN').evaluate(el => getComputedStyle(el.parentElement).outlineStyle),'solid');
    await languageRadio('system').click();
    assert.equal(await languageRadio('system').isChecked(),true);
    await languageRadio('zh-CN').click();
    await dialog.getByRole('heading',{name:'界面语言',exact:true}).waitFor();
    assert.equal(await dialog.getByRole('switch').count(),0,'trust is not an appearance preference');
    assert.equal(await dialog.getByRole('button',{name:'安装皮肤插件',exact:true}).count(),0,'appearance selects skins without managing packages');
    await page.screenshot({path:`/tmp/aibo-settings-${kit}-${theme}-appearance.png`});
    await tab('外观').focus();
    await page.keyboard.press('ArrowDown');
    await selected('布局');
    assert.equal(await tab('布局').evaluate(el=>el===document.activeElement),true);
    await dialog.getByRole('button',{name:'交换工作台侧边区域',exact:true}).click();
    await page.locator('[data-presentation-layout="review"][aria-busy="false"]').waitFor();
    await dialog.getByRole('button',{name:'恢复标准布局',exact:true}).click();
    await page.locator('[data-presentation-layout="standard"][aria-busy="false"]').waitFor();
    assert.equal(await page.locator('.app-shell').getAttribute('data-ui-theme'),theme);
    await tab('工作区').click();
    const trust = dialog.getByRole('switch',{name:'新增工作区默认信任'});
    assert.equal(await trust.isChecked(),true);
    await trust.click();
    await page.waitForFunction(()=>window.settingsCalls.some(c=>c.command==='save_workspace_preferences'&&c.args.trustNewWorkspaces===false));
    await tab('外观').click();
    await dialog.getByRole('button',{name:'管理皮肤插件…',exact:true}).click();
    await selected('插件与能力');
    assert.equal(await dialog.locator('#presentation-packages').evaluate(el=>el===document.activeElement),true);
    await page.evaluate(()=>window.settingsReadErrorKey='native.settings.storageUnavailable');
    await dialog.getByRole('button',{name:'设置 · Third Party',exact:true}).click();
    await dialog.getByRole('alert').filter({hasText:'配置存储不可用'}).waitFor();
    const failedReads=await page.evaluate(()=>window.settingsCalls.filter(call=>call.command==='read_agent_settings').length);
    await page.evaluate(async()=>{const {language}=await import('/src/lib/i18n/runtime.ts');language.set({preference:'en',locale:'en'});});
    await dialog.getByRole('alert').filter({hasText:'Configuration storage is unavailable.'}).waitFor();
    assert.equal(await page.evaluate(()=>window.settingsCalls.filter(call=>call.command==='read_agent_settings').length),failedReads);
    await page.evaluate(async()=>{const {language}=await import('/src/lib/i18n/runtime.ts');language.set({preference:'zh-CN',locale:'zh-CN'});delete window.settingsReadErrorKey;});
    await dialog.getByRole('button',{name:'重试',exact:true}).click();
    const instructions = dialog.getByRole('textbox',{name:'附加指令',exact:true});
    await instructions.fill('Unsaved instructions');
    await dialog.getByRole('status').filter({hasText:'有未保存的修改'}).waitFor();
    await tab('工作区').click();
    assert.equal(await trust.isChecked(),false);
    await tab('插件与能力').click();
    assert.equal(await instructions.inputValue(),'Unsaved instructions');
    await page.keyboard.press('Escape');
    await trigger.waitFor();
    await page.waitForFunction(()=>document.activeElement?.textContent?.trim()==='工作台设置');
    await page.getByRole('button',{name:'插件与能力',exact:true}).click();
    await selected('插件与能力');
    assert.equal(await instructions.inputValue(),'Unsaved instructions','closing the dialog retains plugin drafts');
    assert.equal(await page.evaluate(()=>window.settingsCalls.filter(c=>c.command==='save_agent_settings').length),0);
    await dialog.getByRole('button',{name:'保存设置',exact:true}).click();
    await dialog.getByRole('status').filter({hasText:'已保存，将在下一次调用时提供给 Agent。'}).waitFor();
    assert.equal(await dialog.getByRole('status').filter({hasText:'有未保存的修改'}).count(),0);
    await dialog.getByRole('button',{name:'当前项目',exact:true}).click();
    assert.equal(await instructions.inputValue(),'Unsaved instructions','workspace inherits the saved global value');
    for(const [key,zh,en] of [
      ['native.settings.concurrentChanged','配置已被其他窗口修改，请重新加载后再保存','Another window changed these settings. Reload them before saving.'],
      ['native.settings.versionChanged','设置版本已改变，请重新加载','The settings version changed. Reload settings.'],
      ['native.settings.storageUnavailable','配置存储不可用','Configuration storage is unavailable.'],
    ]) {
      await page.evaluate(key=>window.settingsErrorKey=key,key);await instructions.fill('原始配置 {error}');
      await dialog.getByRole('button',{name:'保存设置',exact:true}).click();await dialog.getByRole('alert').filter({hasText:zh}).waitFor();
      const writes=await page.evaluate(()=>window.settingsCalls.filter(call=>call.command==='save_agent_settings').length);
      const request=await page.evaluate(()=>window.settingsCalls.filter(call=>call.command==='save_agent_settings').at(-1).args.request);
      assert.equal(request.installationId,'third-party-release');assert.equal(request.contributionId,'third.party.agent');assert.deepEqual(request.scope,{kind:'workspace',id:'w1'});assert.equal(request.values.instructions,'原始配置 {error}');
      await page.evaluate(async()=>{const {language}=await import('/src/lib/i18n/runtime.ts');language.set({preference:'en',locale:'en'});});
      await dialog.getByRole('alert').filter({hasText:en}).waitFor();assert.equal(await instructions.inputValue(),'原始配置 {error}');
      assert.equal(await page.evaluate(()=>window.settingsCalls.filter(call=>call.command==='save_agent_settings').length),writes);
      await page.evaluate(async()=>{const {language}=await import('/src/lib/i18n/runtime.ts');language.set({preference:'zh-CN',locale:'zh-CN'});});await dialog.getByRole('alert').filter({hasText:zh}).waitFor();
    }
    await page.evaluate(()=>delete window.settingsErrorKey);
    await tab('运行与诊断').click();
    await dialog.getByRole('heading',{name:'运行环境',exact:true}).waitFor();
    await dialog.getByRole('button',{name:'查看执行历史',exact:true}).waitFor();
    for (const width of kit === 'ak-ui' ? [480,390] : [760,480,390]) {
      await page.setViewportSize({width,height:820});
      for (const name of ['外观','布局','工作区','插件与能力','运行与诊断']) {
        await tab(name).click();
        assert.equal(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth),true,`${name}: dialog fits ${width}px`);
        assert.equal(await dialog.locator('.management-content').evaluate(el=>el.scrollWidth<=el.clientWidth),true,`${name}: content fits ${width}px`);
        for (const item of await dialog.getByRole('tab').all()) {
          const b=await item.boundingBox(),d=await dialog.boundingBox();
          assert.ok(b.height>=44 && b.x>=d.x && b.x+b.width<=d.x+d.width,`${name}: all navigation targets remain reachable`);
        }
      }
      await tab('外观').click();
      await checkLanguageLayout();
      await page.screenshot({path:`/tmp/aibo-settings-${kit}-${theme}-${width}.png`});
    }
    await dialog.getByRole('button',{name:'关闭设置',exact:true}).click();
    assert.deepEqual(errors,[]);
    await page.close();
    console.log(`${theme}: five sections, both entry points, keyboard/focus, layout recovery, trust persistence, third-party draft/save/inheritance and narrow layouts passed`);
  }
} finally { await browser.close(); await server.close(); }
