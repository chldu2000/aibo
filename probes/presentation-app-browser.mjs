import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const source="self.aiboPresentation={render(input){if(input.data.draft==='crash')throw Error('probe runtime failure');return {tag:'main',key:'main',children:[{tag:'h1',key:'heading',text:'External workbench'},{tag:'textarea',key:'draft',attrs:{'aria-label':'External draft',value:input.data.draft||''},events:{input:'draft'}}]}}};";
const bytes=Buffer.from(source);
const pkg={release:{digest:'a'.repeat(64),enabled:true,manifest:{schema:'aibo.presentation-package/v1',id:'dev.example.workbench',version:'1.0.0',displayName:'External skin',hostApi:'1.0.0',coreSemantics:'1.0.0',snapshotSchemas:['aibo.semantic-view/v1'],entry:'skin.js',surfaces:['workbench'],resources:[{path:'skin.js',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),mediaType:'text/javascript'}]}},resources:{'skin.js':bytes.toString('base64')}};
const server=await createServer({server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false,watch:null}});await server.listen();
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];
page.on('pageerror',error=>errors.push(error.message));
try {
  await page.addInitScript(pkg=>{
    if(window===window.top&&!localStorage.getItem('aibo.appearance.v1'))localStorage.setItem('aibo.appearance.v1',JSON.stringify({kitId:'material3',themeId:'sage'}));
    let callback=0;window.presentationCommands=[];window.presentationInstallable=pkg;
    const read=()=>JSON.parse(localStorage.getItem('probe.presentation.installed')||'null');
    const saved=()=>JSON.parse(localStorage.getItem('probe.presentation.selection')||'null');
    window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},
      transformCallback(fn){const id=++callback;window['_'+id]=fn;return id;},unregisterCallback(id){delete window['_'+id];},
      async invoke(command,args={}){
        if(command==='read_workspace_preferences')return {trustNewWorkspaces:true};
        window.presentationCommands.push(command);
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
        if(command==='get_app_snapshot')return {platform:'macos',appVersion:'probe',workspaceCount:0,diagnostics:[]};
        return [];
      }};
  },pkg);
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
  const assertMigrated=async()=>{
    assert.equal(await page.locator('.app-shell').getAttribute('data-ui-kit'),'ak-ui');
    assert.equal(await page.locator('.app-shell').getAttribute('data-ui-theme'),'dark');
    assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('aibo.appearance.v1'))),{kitId:'ak-ui',themeId:'dark'});
  };
  await page.getByRole('button',{name:/^打开工作台设置/}).waitFor();
  await assertMigrated();
  await page.getByRole('button',{name:/^打开工作台设置/}).click();
  await page.getByRole('tab',{name:'插件与能力',exact:true}).click();
  await page.getByRole('button',{name:'安装皮肤插件',exact:true}).click();
  await page.getByRole('tab',{name:'外观',exact:true}).click();
  await page.getByRole('button',{name:'External skin 1.0.0',exact:true}).click();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('probe.presentation.selection')||'null')!==null);
  assert.equal(await page.locator('.appearance-kit-option[aria-pressed="true"]').count(),1);
  assert.match(await page.locator('.appearance-kit-option[aria-pressed="true"]').textContent(),/External skin/);
  await page.getByRole('button',{name:'关闭设置',exact:true}).click();
  const editor=page.frameLocator('iframe').getByRole('textbox',{name:'External draft'});
  await editor.fill('saved draft');
  await page.waitForFunction(()=>document.querySelector('iframe')?.dataset.presentationRevision);
  await editor.pressSequentially(' quick typing',{delay:10});
  await page.waitForTimeout(250);
  assert.equal(await editor.inputValue(),'saved draft quick typing');
  await page.getByRole('button',{name:/^打开工作台设置/}).click();
  await page.getByRole('button',{name:'恢复内置皮肤',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('iframe').length===0);
  await assertMigrated();
  await page.getByRole('button',{name:'External skin 1.0.0',exact:true}).click();
  await page.getByRole('button',{name:'关闭设置',exact:true}).click();
  await editor.waitFor();assert.equal(await editor.inputValue(),'saved draft quick typing');
  await page.reload();
  await page.frameLocator('iframe').getByRole('heading',{name:'External workbench'}).waitFor();
  await page.frameLocator('iframe').getByRole('textbox',{name:'External draft'}).click();
  await page.keyboard.press('Control+Shift+Backspace');
  await page.waitForFunction(()=>document.querySelectorAll('iframe').length===0, {}, {timeout:3000});
  await page.getByRole('button',{name:/^打开工作台设置/}).click();
  await page.getByRole('button',{name:'External skin 1.0.0',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('iframe').length===1);
  await page.getByRole('tab',{name:'插件与能力',exact:true}).click();
  await page.getByRole('button',{name:'禁用',exact:true}).click();
  await page.getByRole('tab',{name:'外观',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('iframe').length===0);
  await page.getByRole('tab',{name:'插件与能力',exact:true}).click();
  await page.getByRole('button',{name:'启用',exact:true}).click();
  await page.getByRole('tab',{name:'外观',exact:true}).click();
  await page.getByRole('button',{name:'External skin 1.0.0',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('iframe').length===1);
  await page.getByRole('tab',{name:'插件与能力',exact:true}).click();
  await page.getByRole('button',{name:'卸载',exact:true}).click();
  await page.getByRole('tab',{name:'外观',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('iframe').length===0);
  await page.getByRole('tab',{name:'插件与能力',exact:true}).click();
  await page.getByRole('button',{name:'安装皮肤插件',exact:true}).click();
  await page.getByRole('tab',{name:'外观',exact:true}).click();
  await page.getByRole('button',{name:'External skin 1.0.0',exact:true}).click();
  await page.getByRole('button',{name:'关闭设置',exact:true}).click();
  await page.frameLocator('iframe').getByRole('textbox',{name:'External draft'}).fill('crash');
  await page.waitForFunction(()=>document.querySelectorAll('iframe').length===0 && JSON.parse(localStorage.getItem('probe.presentation.selection')||'null')===null);
  await page.getByRole('button',{name:/^打开工作台设置/}).click();
  await page.getByRole('alert').filter({hasText:'probe runtime failure'}).waitFor();
  await page.getByRole('tab',{name:'插件与能力',exact:true}).click();
  await page.getByRole('button',{name:'卸载',exact:true}).click();
  await page.getByRole('tab',{name:'外观',exact:true}).click();
  await page.evaluate(()=>{window.presentationInstallable={release:{digest:'b'.repeat(64),enabled:true,manifest:{schema:'aibo.presentation-package/v1',id:'dev.example.theme',version:'1.0.0',displayName:'Theme skin',hostApi:'1.0.0',coreSemantics:'1.0.0',snapshotSchemas:['aibo.semantic-view/v1'],resources:[],themes:[{id:'night',label:'Night',colorScheme:'dark',tokens:{'--aibo-bg':'#112233'}}],defaultThemeId:'night'}},resources:{}};});
  await page.getByRole('tab',{name:'插件与能力',exact:true}).click();
  await page.getByRole('button',{name:'安装皮肤插件',exact:true}).click();
  await page.getByRole('tab',{name:'外观',exact:true}).click();
  await page.getByRole('button',{name:'Theme skin 1.0.0',exact:true}).click();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('probe.presentation.selection')||'null')?.digest==='b'.repeat(64));
  assert.equal(await page.locator('.presentation-fallback').evaluate(element=>getComputedStyle(element).getPropertyValue('--aibo-bg')),'#112233');
  assert.notEqual(await page.locator('.app-shell').evaluate(element=>getComputedStyle(element).getPropertyValue('--aibo-bg')),'#112233');
  assert.equal(await page.locator('iframe').count(),0);
  await page.getByRole('button',{name:'恢复内置皮肤',exact:true}).click();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('probe.presentation.selection')||'null')===null);
  await assertMigrated();
  assert.equal(await page.locator('.appearance-kit-option[aria-pressed="true"]').count(),1);
  assert.match(await page.locator('.appearance-kit-option[aria-pressed="true"]').textContent(),/Aibo · ak-ui/);
  assert.deepEqual(errors,[]);
  const result={passed:true,nativePort:'mocked; actual App.svelte and sandbox runtime',browser:browser.version(),checks:['legacy brightness migrates on startup and survives, external selection, restart and fallback through the unified selector','install and select through settings','draft typing and restoration across switches','selection reloaded after page restart','disable enable uninstall','host controls and keyboard recovery accessible','runtime failure clears persistent selection','theme-only package inherits workbench and cannot style host shell']};
  await writeFile('/tmp/aibo-presentation-app-browser.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
} finally {await browser.close();await server.close();}
