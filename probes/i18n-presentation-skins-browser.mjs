import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {buildPresentationSkins} from './lib/build-presentation-skins.mjs';
const built=await buildPresentationSkins();
const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false,watch:null}});await server.listen();
const browser=await chromium.launch({headless:true});
try {
 for(const pkg of built.packages) for(const scheme of ['light','dark']) {
  const context=await browser.newContext();const page=await context.newPage({viewport:{width:1280,height:900}});
  page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(60000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(pkg=>{
    if(window===window.top)localStorage.setItem('aibo.language.v1','zh-CN');
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
  const management=page.locator('[data-host-navigation="management"]');
  await management.click();
  await page.getByRole('tab',{name:'插件与能力',exact:true}).click();
  await page.getByRole('button',{name:'安装皮肤插件',exact:true}).click();
  await page.getByRole('tab',{name:'外观',exact:true}).click();
  await page.getByRole('button',{name:pkg.release.manifest.displayName+' '+pkg.release.manifest.version,exact:true}).click();
  const theme=pkg.release.manifest.themes.find(theme=>theme.colorScheme===scheme);
  assert.ok(theme);
  await page.locator(`input[name="appearance-theme"][value="${theme.id}"]`).check();
  await page.waitForFunction(theme=>JSON.parse(localStorage.getItem('probe.presentation.selection')||'null')?.themeId===theme,theme.id);
  await page.getByRole('button',{name:'关闭设置',exact:true}).click();
  const frame=page.frameLocator('iframe');
  await frame.getByRole('heading',{name:'工作区',exact:true}).waitFor();
  await page.locator('iframe').evaluate(element=>element.dataset.probeIdentity='same-instance');
  await management.click();
  await page.getByRole('radio',{name:'English',exact:true}).check();
  await page.getByRole('button',{name:'Close settings',exact:true}).click();
  await frame.getByRole('heading',{name:'Workspaces',exact:true}).waitFor();
  await frame.getByRole('button',{name:'Add workspace',exact:true}).waitFor();
  await frame.getByRole('button',{name:'Side panel',exact:true}).waitFor();
  await frame.getByRole('heading',{name:'Select or create a session',exact:true}).waitFor();
  await frame.getByRole('button',{name:'Context',exact:true}).click();
  await frame.getByRole('heading',{name:'Context',exact:true}).waitFor();
  await frame.getByRole('heading',{name:'Project actions',exact:true}).waitFor();
  await frame.getByRole('button',{name:'Git',exact:true}).click();
  await frame.getByRole('heading',{name:'Git',exact:true}).waitFor();
  await frame.getByText('No Git repositories found in the workspace',{exact:true}).waitFor();
  assert.equal(await page.locator('iframe').getAttribute('data-probe-identity'),'same-instance');
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('probe.presentation.selection')).digest),pkg.release.digest);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('probe.presentation.selection')).themeId),theme.id);
  await management.click();
  await page.getByRole('radio',{name:'简体中文',exact:true}).check();
  await page.getByRole('button',{name:'关闭设置',exact:true}).click();
  await frame.getByRole('heading',{name:'工作区',exact:true}).waitFor();
  await frame.getByRole('button',{name:'添加工作区',exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  await context.close();console.log(`packed skin i18n ${pkg.release.manifest.id} ${scheme}: live navigation, conversation, Inspector, Git, same instance and theme passed`);
 }
} finally {await browser.close();await server.close();await built.dispose();}
