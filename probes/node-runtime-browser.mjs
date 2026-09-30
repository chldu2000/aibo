import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { buildPresentationSkins } from './lib/build-presentation-skins.mjs';
const skins = await buildPresentationSkins();
const server = await createServer({server:{host:'127.0.0.1',port:0,hmr:false,watch:null}}); await server.listen();
const browser = await chromium.launch({headless:true});
try {
  const cases = ['material3','ak-ui'].flatMap(kit=>['light','dark'].map(theme=>({kit,theme,pkg:null})));
  for(const pkg of skins.packages) cases.push({kit:'material3',theme:'light',pkg});
  for(const config of cases) {
    const page = await browser.newPage({viewport:{width:1280,height:900}}); page.setDefaultTimeout(10000);
    const errors = []; page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(({kit,theme,pkg})=>{
      if(window!==window.top)return;
      localStorage.setItem('aibo.appearance.v1',JSON.stringify({kitId:kit,themeId:theme}));
      let callback=0;
      window.runtimeCalls=[]; window.failDownload=true; window.pickedNode='/custom location/node';
      window.runtimeStatus={selected:null,manualPath:null,hostRequirement:'>=22',downloadVersion:'24.18.0',downloadSupported:true,issues:['本机 Node 18 不满足 >=22']};
      window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback(fn){const id=++callback;window['_'+id]=fn;return id},unregisterCallback(id){delete window['_'+id]},async invoke(command,args={}){
        window.runtimeCalls.push({command,args});
        if(command.startsWith('plugin:event|'))return 1;
        if(command==='get_app_snapshot')return {platform:'macos',appVersion:'probe',workspaceCount:0,diagnostics:[]};
        if(command==='read_workspace_preferences')return {trustNewWorkspaces:true};
        if(command==='read_host_confirmation_preferences')return {git:'always-allow',projectAction:'always-allow',turnRestore:'always-allow',capabilityWrite:'always-allow',viewWrite:'always-allow'};
        if(command==='get_presentation_selection')return pkg?{digest:pkg.release.digest,themeId:pkg.release.manifest.themes[0].id}:null;
        if(command==='list_presentation_packages')return pkg?[pkg.release]:[];
        if(command==='read_presentation_package')return pkg;
        if(command==='get_node_runtime')return structuredClone(window.runtimeStatus);
        if(command==='plugin:dialog|open')return window.pickedNode;
        if(command==='download_node_runtime'){
          await new Promise(done=>setTimeout(done,300));
          if(window.failDownload)throw Error('Node 下载文件校验失败，请重试。');
          window.runtimeStatus={...window.runtimeStatus,selected:{path:'/app data/node-runtime/node',version:'24.18.0',source:'managed'},issues:[]}; return structuredClone(window.runtimeStatus);
        }
        if(command==='select_node_runtime'){
          window.runtimeStatus={...window.runtimeStatus,manualPath:args.path,selected:{path:args.path??'/usr/local/bin/node',version:'24.18.0',source:args.path?'manual':'system'},issues:[]}; return structuredClone(window.runtimeStatus);
        }
        if(command==='get_turn_change_set')return null;
        return [];
      }};
    },config);
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
    if(config.pkg) await page.locator('.presentation-external iframe').first().waitFor();
    await page.getByRole('button',{name:/^打开工作台设置/}).click();
    const dialog=page.getByRole('dialog',{name:'工作台设置',exact:true});
    await dialog.getByRole('tab',{name:'运行与诊断',exact:true}).click();
    const panel=dialog.locator('section[aria-labelledby="node-runtime-title"]');
    await panel.getByText('没有可用的 Node，依赖它的插件暂时无法运行。',{exact:true}).waitFor();
    const download=panel.getByRole('button',{name:/下载 Aibo 专用 Node/});
    await download.click();
    await panel.getByText('正在下载并校验 Node，请稍候…',{exact:true}).waitFor();
    assert.equal(await panel.getByRole('button',{name:'选择 Node 文件…',exact:true}).isDisabled(),true);
    await panel.getByRole('alert').filter({hasText:'校验失败'}).waitFor();
    await page.evaluate(()=>window.failDownload=false); await download.click();
    await panel.getByText('Aibo 专用 Node · 24.18.0',{exact:true}).waitFor(); assert.equal(await panel.getByRole('alert').count(),0);
    await panel.getByRole('button',{name:'选择 Node 文件…',exact:true}).click();
    await panel.getByText('手动选择 · 24.18.0',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.runtimeCalls.find(c=>c.command==='plugin:dialog|open').args.options.directory),false);
    await panel.getByRole('button',{name:'恢复自动查找',exact:true}).click();
    await panel.getByText('本机 Node · 24.18.0',{exact:true}).waitFor();
    await panel.getByRole('button',{name:'重新检测 Node',exact:true}).click();
    await page.waitForFunction(()=>window.runtimeCalls.filter(c=>c.command==='get_node_runtime').length>=2);
    assert.ok(await page.evaluate(()=>window.runtimeCalls.filter(c=>c.command==='list_plugin_installations').length>=4));
    await page.screenshot({path:`/tmp/aibo-node-${config.kit}-${config.theme}-${config.pkg?.release.manifest.id??'builtin'}.png`});
    assert.equal(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth),true);
    assert.deepEqual(errors,[]); await page.close();
    console.log(`${config.kit}/${config.theme}/${config.pkg?.release.manifest.id??'builtin'}: missing, download retry, manual file, automatic, refresh passed`);
  }
} finally { await browser.close(); await server.close(); await skins.dispose(); }
