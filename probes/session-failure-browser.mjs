import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { buildPresentationSkins } from './lib/build-presentation-skins.mjs';

const built = await buildPresentationSkins();
const server = await createServer({server:{host:'127.0.0.1',port:0,hmr:false,watch:null},
  plugins:[{name:'failure-observation',enforce:'pre',transform(code,id){
    if (!id.endsWith('/src/App.svelte')) return;
    return code.replace('</script>', `
      if (typeof window !== 'undefined') (window as any).failureState = () => ({
        selected:selectedSessionId, sessions:workspaceSessionMap.w, active:activeAgentSessionIds,
      });
    </script>`);
  }}]});
await server.listen();
const browser = await chromium.launch({headless:true});
try {
  const cases = ['material3','ak-ui'].flatMap(kitId=>['light','dark'].map(theme=>({kitId,theme,pkg:null})));
  for (const pkg of built.packages) cases.push({kitId:'material3',theme:'light',pkg});
  for (const config of cases) {
    const page = await browser.newPage({viewport:{width:1280,height:900}});
    page.setDefaultTimeout(10000);
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(({kitId,theme,pkg})=>{
      if (window!==window.top) return;
      localStorage.setItem('aibo.language.v1','zh-CN');
      localStorage.setItem('aibo.appearance.v1',JSON.stringify({kitId,themeId:theme}));
      const workspace={id:'w',label:'失败回归',path:'/probe',trust:'trusted',createdAt:'2026-10-14',updatedAt:'2026-10-14'};
      const session={id:'s',workspaceId:'w',label:'失败会话',agent:'external.agent',pluginInstallationId:'fixture',state:'running',archived:false,externalSessionId:'native',capabilities:[],createdAt:'2026-10-14',updatedAt:'2026-10-14'};
      let callback=0,handler,sequence=0;
      window.freezeFailureRefresh=false;
      window.emitFailure=(type,payload)=>{
        window.freezeFailureRefresh=true;
        window['_'+handler]({event:'agent-event',id:1,payload:{schemaVersion:'2.0',eventId:'event-'+ ++sequence,generationId:'g',sequence,occurredAt:new Date().toISOString(),source:{},workspaceId:'w',sessionId:'s',turnId:'t',type,payload}});
      };
      window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},
        transformCallback(fn){const id=++callback;window['_'+id]=fn;return id;},unregisterCallback(id){delete window['_'+id];},
        async invoke(command,args={}){
          if(command==='plugin:event|listen'){if(args.event==='agent-event')handler=args.handler;return 1;}
          if(command.startsWith('plugin:event|'))return 1;
          if(command==='get_app_snapshot')return {platform:'macos',appVersion:'probe',workspaceCount:1,diagnostics:[]};
          if(command==='list_workspaces')return [workspace];
          if(command==='list_sessions')return window.freezeFailureRefresh?new Promise(()=>{}):[{...session}];
          if(command==='get_presentation_selection')return pkg?{digest:pkg.release.digest,themeId:null}:null;
          if(command==='list_presentation_packages')return pkg?[pkg.release]:[];
          if(command==='read_presentation_package')return pkg;
          if(command==='get_timeline')return [{id:'user',sessionId:'s',turnId:'t',role:'user',toolName:null,content:'原始问题',status:'completed',createdAt:'2026-10-14',updatedAt:'2026-10-14'}];
          if(command==='get_composer_draft'||command==='get_turn_change_set')return null;
          if(command==='save_composer_draft')return {text:args.text,updatedAt:'2026-10-14'};
          if(command==='get_session_execution_profile')return {sessionId:'s',requested:{},enforced:{},unsupported:[],adapterCapabilities:[],sessionControls:[]};
          if(command==='get_workspace_changes')return {workspaceId:'w',dirty:false,files:[],captureStatus:'captured'};
          if(command==='list_workspace_git_repositories')return {repositories:[],limited:false,warnings:[]};
          if(command==='inspect_workspace_capabilities')return {workspaceId:'w',instructions:[],skills:[],tools:[],mcpServers:[],warnings:[]};
          if(command==='read_workspace_preferences')return {trustNewWorkspaces:true};
          return [];
        }};
    },config);
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
    const view=config.pkg?page.frameLocator('.presentation-external iframe:visible'):page;
    await view.getByText('失败会话',{exact:true}).first().click();
    await page.waitForFunction(()=>window.failureState().selected==='s');
    const stop=view.getByRole('button',{name:/^(停止|中止)$/});
    assert.equal(await stop.isEnabled(),true);
    for (const [type,payload] of [
      ['adapter.crashed',{reason:'busy: 工作区写入忙',status:'failed'}],
      ['turn.failed',{error:{code:'busy',message:'workspace busy'},localizedReason:{schema:'aibo.host-message/v1',key:'native.error.workspaceWriteBusy',params:{}}}],
    ]) {
      await page.evaluate(()=>window.emitFailure('turn.started',{}));
      await page.waitForFunction(()=>window.failureState().sessions[0].state==='running');
      await page.evaluate(({type,payload})=>window.emitFailure(type,payload),{type,payload});
      await page.waitForFunction(()=>window.failureState().sessions[0].state==='failed'&&!window.failureState().active.includes('s'));
      await page.waitForFunction(()=>!document.body.textContent.includes('进程已退出'));
      if(await stop.count())assert.equal(await stop.isEnabled(),false);
      const input=view.locator('textarea').first();
      assert.equal(await input.isEditable(),true);
      await input.fill('失败之后的新草稿');
      assert.equal(await input.inputValue(),'失败之后的新草稿');
      if(type==='turn.failed')await view.getByText('工作区有尚未结束的写入，请等待完成后再操作。',{exact:false}).first().waitFor();
    }
    assert.deepEqual(errors,[]);
    console.log(`${config.pkg?.release.manifest.id??config.kitId} ${config.theme}: failure converges without refresh; composer remains editable`);
    await page.close();
  }
} finally {await browser.close();await server.close();await built.dispose();}
