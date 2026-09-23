import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const server=await createServer({server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false,watch:null}});await server.listen();
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:960}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
await mkdir('/tmp/aibo-workspace-preferences',{recursive:true});
try {
  await page.addInitScript(()=>{
    const make=(id,path,trust)=>({id,path,label:path.split('/').at(-1),trust,createdAt:'2026-09-22',updatedAt:'2026-09-22',lastOpenedAt:null});
    if(!localStorage.getItem('probe.workspaces'))localStorage.setItem('probe.workspaces',JSON.stringify([make('existing','/probe/existing','untrusted')]));
    const workspaces=()=>JSON.parse(localStorage.getItem('probe.workspaces'));
    const preferences=()=>({trustNewWorkspaces:localStorage.getItem('probe.trust-default')!=='false'});
    let callback=0;window.preferenceCalls=[];window.nextDirectory='/probe/default-trusted';
    window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback(fn){const id=++callback;window['_'+id]=fn;return id},unregisterCallback(id){delete window['_'+id]},async invoke(command,args={}){
      window.preferenceCalls.push({command,args});
      if(command.startsWith('plugin:event|'))return 1;
      if(command==='get_app_snapshot')return {platform:'macos',appVersion:'probe',workspaceCount:workspaces().length,diagnostics:[]};
      if(command==='list_workspaces')return workspaces();
      if(command==='read_workspace_preferences'){if(window.failPreferenceRead)throw Error('读取工作区设置失败');return preferences()}
      if(command==='save_workspace_preferences'){
        await new Promise(resolve=>setTimeout(resolve,50));
        if(window.failPreferenceSave)throw Error('保存工作区设置失败');
        localStorage.setItem('probe.trust-default',String(args.trustNewWorkspaces));return preferences();
      }
      if(command==='plugin:dialog|open')return window.nextDirectory;
      if(command==='add_workspace'){
        const list=workspaces();const existing=list.find(w=>w.path===args.path);if(existing)return existing;
        const next=make('workspace-'+list.length,args.path,preferences().trustNewWorkspaces?'trusted':'untrusted');list.push(next);localStorage.setItem('probe.workspaces',JSON.stringify(list));return next;
      }
      if(command==='set_workspace_trust'){
        const list=workspaces();const next=list.find(w=>w.id===args.workspaceId);next.trust=args.trusted?'trusted':'untrusted';localStorage.setItem('probe.workspaces',JSON.stringify(list));return next;
      }
      if(command==='get_presentation_selection'||command==='get_session_execution_profile'||command==='get_turn_change_set')return null;
      if(command==='list_workspace_git_repositories')return {repositories:[],limited:false,warnings:[],scanBudget:2000};
      if(command==='get_workspace_changes')return {workspaceId:args.workspaceId,head:null,branch:null,dirty:false,capturedAt:'now',files:[],captureStatus:'captured',captureError:null};
      if(command==='get_workspace_git_remote_status')return {branch:null,upstream:null,ahead:0,behind:0};
      if(command==='inspect_workspace_capabilities')return {workspaceId:args.workspaceId,inspectedAt:'now',instructions:[],skills:[],tools:[],mcpServers:[],warnings:[]};
      return [];
    }};
  });
  const url=`http://127.0.0.1:${server.httpServer.address().port}`;
  await page.goto(url);await page.locator('.workspace-item').waitFor();
  assert.equal(await page.locator('.workspace-trust-dot').count(),0);
  const add=async path=>{
    await page.evaluate(value=>window.nextDirectory=value,path);
    const previous=await page.evaluate(()=>window.preferenceCalls.filter(c=>c.command==='add_workspace').length);
    await page.getByRole('button',{name:'添加工作区',exact:true}).click();
    await page.waitForFunction(count=>window.preferenceCalls.filter(c=>c.command==='add_workspace').length>count,previous);
    await page.locator('.workspace-item').filter({hasText:path.split('/').at(-1)}).waitFor();
    return page.evaluate(path=>JSON.parse(localStorage.getItem('probe.workspaces')).find(w=>w.path===path),path);
  };
  assert.equal((await add('/probe/default-trusted')).trust,'trusted');
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('probe.workspaces'))[0].trust),'untrusted');
  const open=async()=>{await page.getByRole('button',{name:'工作台设置',exact:true}).click();await page.getByRole('switch',{name:'新增工作区默认信任'}).waitFor()};
  const toggle=page.getByRole('switch',{name:'新增工作区默认信任'});
  await open();assert.equal(await toggle.isChecked(),true);
  await page.screenshot({path:'/tmp/aibo-workspace-preferences/default-on.png'});
  await toggle.click();await page.waitForFunction(()=>localStorage.getItem('probe.trust-default')==='false');
  assert.equal(await toggle.isChecked(),false);await page.getByRole('button',{name:'关闭管理中心',exact:true}).click();
  assert.equal((await add('/probe/default-untrusted')).trust,'untrusted');
  await page.reload();await page.locator('.workspace-item').first().waitFor();await open();
  assert.equal(await toggle.isChecked(),false,'preference is loaded again after reload');
  await page.evaluate(()=>window.failPreferenceSave=true);await toggle.click();
  await page.getByRole('alert').filter({hasText:'保存工作区设置失败'}).waitFor();
  assert.equal(await toggle.isChecked(),false,'failed save does not change the displayed setting');
  await page.evaluate(()=>window.failPreferenceSave=false);await toggle.click();
  await page.waitForFunction(()=>localStorage.getItem('probe.trust-default')==='true');
  await page.getByRole('button',{name:'关闭管理中心',exact:true}).click();
  assert.equal((await add('/probe/default-untrusted')).trust,'untrusted','re-adding an existing workspace preserves trust');
  assert.equal((await add('/probe/trusted-again')).trust,'trusted');
  // Revocation remains available in the host navigation menu, not as a row dot.
  const row=page.locator('.workspace-item-row').filter({hasText:'trusted-again'});await row.hover();
  await row.getByRole('button',{name:/更多操作$/}).click();await page.locator(':popover-open').getByRole('button',{name:'撤销信任',exact:true}).click();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('probe.workspaces')).find(w=>w.path==='/probe/trusted-again').trust==='untrusted');
  assert.equal((await add('/probe/trusted-again')).trust,'untrusted');
  await page.evaluate(()=>window.failPreferenceRead=true);await open();
  await page.getByRole('alert').filter({hasText:'读取工作区设置失败'}).waitFor();assert.equal(await toggle.isDisabled(),true);
  await page.evaluate(()=>window.failPreferenceRead=false);await page.getByRole('button',{name:'重新读取设置',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('input[role="switch"]').disabled);assert.equal(await toggle.isChecked(),true);
  await page.locator('.appearance-theme-option').filter({hasText:'深色'}).click();
  await toggle.scrollIntoViewIfNeeded();
  await page.screenshot({path:'/tmp/aibo-workspace-preferences/dark.png'});
  await toggle.focus();await page.keyboard.press('Space');
  await page.waitForFunction(()=>localStorage.getItem('probe.trust-default')==='false');
  assert.equal(await toggle.isChecked(),false,'keyboard activation saves the native default');
  await page.setViewportSize({width:390,height:844});await toggle.scrollIntoViewIfNeeded();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:'/tmp/aibo-workspace-preferences/narrow.png'});
  assert.deepEqual(errors,[]);
  assert(await page.evaluate(()=>window.preferenceCalls.filter(c=>c.command==='add_workspace').every(c=>Object.keys(c.args).join(',')==='path')),'native host owns the trust default');
  console.log('PASS: no row trust dot; default-on/off creation, persisted settings reload, read/save failures and retry, existing directory trust and manual revocation retained. Native IPC is mocked; SQLite persistence is covered by Rust tests.');
} catch(error){console.error(JSON.stringify({errors}));await page.screenshot({path:'/tmp/aibo-workspace-preferences/failure.png'});throw error}
finally{await browser.close();await server.close()}
