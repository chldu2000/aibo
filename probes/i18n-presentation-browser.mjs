import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const source="self.aiboPresentation={render(input){if(input.data.draft==='crash')throw Error('probe runtime failure');return {tag:'main',key:'main',children:[{tag:'h1',key:'heading',text:input.locale==='en'?'External workbench':'外部工作台'},{tag:'textarea',key:'draft',attrs:{'aria-label':'External draft',value:input.data.draft||''},events:{input:'draft'}}]}}};";
const bytes=Buffer.from(source);
const pkg={release:{digest:'a'.repeat(64),enabled:true,manifest:{schema:'aibo.presentation-package/v1',id:'dev.example.workbench',version:'1.0.0',displayName:'External skin',hostApi:'1.0.0',coreSemantics:'1.0.0',snapshotSchemas:['aibo.semantic-view/v1'],entry:'skin.js',surfaces:['workbench'],resources:[{path:'skin.js',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),mediaType:'text/javascript'}]}},resources:{'skin.js':bytes.toString('base64')}};
const server=await createServer({server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false,watch:null}});await server.listen();
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];
page.on('pageerror',error=>errors.push(error.message));
try {
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
  await page.getByRole('button',{name:'External skin 1.0.0',exact:true}).click();
  await page.getByRole('button',{name:'关闭设置',exact:true}).click();
  const frame=page.frameLocator('iframe');
  await frame.getByRole('heading',{name:'外部工作台',exact:true}).waitFor();
  const editor=frame.getByRole('textbox',{name:'External draft'});
  await editor.fill('草稿 stays unchanged');
  const revision=await page.locator('iframe').getAttribute('data-presentation-revision');
  await page.locator('iframe').evaluate(element=>element.dataset.probeIdentity='same-instance');
  const digest=await page.evaluate(()=>JSON.parse(localStorage.getItem('probe.presentation.selection')).digest);
  await management.click();
  await page.getByRole('radio',{name:'English',exact:true}).check();
  await page.getByRole('button',{name:'Close settings',exact:true}).click();
  await frame.getByRole('heading',{name:'External workbench',exact:true}).waitFor();
  assert.equal(await editor.inputValue(),'草稿 stays unchanged');
  assert.equal(await page.locator('iframe').getAttribute('data-probe-identity'),'same-instance');
  assert.ok(Number(await page.locator('iframe').getAttribute('data-presentation-revision'))>Number(revision));
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('probe.presentation.selection')).digest),digest);
  await editor.fill('crash');
  await page.waitForFunction(()=>document.querySelectorAll('iframe').length===0 && JSON.parse(localStorage.getItem('probe.presentation.selection')||'null')===null);
  await page.getByRole('button',{name:'Workbench settings',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'probe runtime failure'}).waitFor();
  await page.getByRole('radio',{name:'简体中文',exact:true}).check();
  await page.getByRole('button',{name:'关闭设置',exact:true}).click();
  assert.equal(await page.locator('html').getAttribute('lang'),'zh-CN');
  assert.deepEqual(errors,[]);
  console.log('external i18n: live locale, same iframe, draft and selection preserved, failure fallback passed');
} finally {await browser.close();await server.close();}
