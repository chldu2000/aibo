import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright';
const server=await createServer({server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false,watch:null}});await server.listen();
const browser=await chromium.launch({headless:true});
try {
 for(const kit of ['material3','ak-ui']) for(const theme of ['light','dark']) {
  const page=await browser.newPage({locale:'zh-CN',viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  await page.evaluate(async ({kit,theme})=>{const r=await import('/src/lib/ui-kit/registry.ts');r.setUiKit(kit);r.setUiTheme(theme)},{kit,theme});
  const dock=page.locator('.sidebar-dock');await dock.waitFor();
  await dock.getByRole('tab',{name:'上下文',exact:true}).click();
  if(kit==='material3'&&theme==='light'){
   const tab=await dock.getByRole('tab',{name:'上下文',exact:true}).boundingBox();
   await page.mouse.move(tab.x+tab.width/2,tab.y+tab.height/2);await page.mouse.down();
   await page.mouse.move(tab.x+tab.width/2+15,tab.y+tab.height/2+15,{steps:3});
   const drop=dock.getByRole('button',{name:'分屏',exact:true}).last();
   await page.waitForFunction(()=>document.querySelectorAll('.sidebar-dock-pane > button').length>0);
   const bounds=await drop.boundingBox();
   await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2,{steps:8});await page.mouse.up();
  }else await dock.getByRole('button',{name:'分屏',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.sidebar-dock-pane').length===2);
  assert.equal(await dock.locator('.sidebar-dock-pane').count(),2);
  assert.equal(await dock.locator('.sidebar-dock-content:not([hidden])').count(),2);
  await dock.getByRole('button',{name:'浮动',exact:true}).last().click();
  const floating=dock.locator('.floating');await floating.waitFor();
  const before=await floating.boundingBox();
  const move=floating.getByRole('button',{name:'移动面板',exact:true});await move.focus();await page.keyboard.press('ArrowRight');
  assert.equal(Math.round((await floating.boundingBox()).x-before.x),20);
  await page.screenshot({path:`/tmp/aibo-sidebar-dock-${kit}-${theme}.png`});
  await page.reload();await page.locator('.sidebar-dock .floating').waitFor();
  await page.locator('.sidebar-dock .floating').getByRole('button',{name:'停靠',exact:true}).click();
  assert.equal(await page.locator('.sidebar-dock-pane').count(),1);
  const tab=page.locator('.sidebar-dock').getByRole('tab',{name:'上下文',exact:true});
  await tab.dragTo(page.locator('.sidebar-dock').getByRole('tab',{name:'Git',exact:true}));
  assert.equal(await page.locator('.sidebar-dock [role=tab]').first().textContent(),'上下文');
  await tab.focus();await page.keyboard.press('ArrowLeft');
  assert.equal(await page.locator('.sidebar-dock').getByRole('tab',{name:'Git',exact:true}).getAttribute('aria-selected'),'true');
  assert.deepEqual(errors,[]);await page.close();
 }
 const page=await browser.newPage({locale:'zh-CN',viewport:{width:1440,height:900}});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{
  let callback=0;window.sidebarCalls=[];window.sidebarEnabled=true;
  window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback(fn){const id=++callback;window['_'+id]=fn;return id},unregisterCallback(id){delete window['_'+id]},async invoke(command,args={}){
   window.sidebarCalls.push({command,args});
   if(command.startsWith('plugin:event|'))return 1;
   if(command==='get_app_snapshot')return {platform:'macos',appVersion:'probe',workspaceCount:0,diagnostics:[]};
   if(command==='get_presentation_selection')return null;
   if(command==='list_semantic_contributions')return window.sidebarEnabled?['one','two'].map(id=>({installationId:'installed-'+id,contributionId:'example.'+id,title:'Plugin '+id,scope:'application',visibility:'always',extensionPoint:'command',available:true,issue:null})):[];
   if(command==='open_semantic_contribution')return {schema:'aibo.semantic-view/v1',context:{workspaceId:null,contributionId:args.contributionId,generation:args.contributionId,revision:1},contribution:{id:args.contributionId,extensionPoint:'command',title:args.contributionId},state:{status:'ready',message:''},view:{kind:'detail',itemId:'entry',properties:[],content:'Content '+args.contributionId,truncated:false},actions:[]};
   return [];
  }};
 });
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
 const dock=page.locator('.sidebar-dock');await dock.waitFor();
 for(const id of ['one','two']){
  await dock.getByRole('combobox',{name:'打开标签页',exact:true}).click();
  await page.getByRole('option',{name:'Plugin '+id,exact:true}).click();
  await dock.getByText('Content example.'+id,{exact:true}).waitFor();
 }
 assert.equal(await page.evaluate(()=>window.sidebarCalls.filter(call=>call.command==='open_semantic_contribution').length),2);
 await dock.getByRole('tab',{name:'Plugin one',exact:true}).click();
 await dock.getByText('Content example.one',{exact:true}).waitFor();
 await dock.getByRole('button',{name:'分屏',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.sidebarCalls.filter(call=>call.command==='open_semantic_contribution').length),2);
 await page.evaluate(async()=>{const r=await import('/src/lib/ui-kit/registry.ts');r.setUiKit('ak-ui')});
 assert.equal(await page.evaluate(()=>window.sidebarCalls.filter(call=>call.command==='open_semantic_contribution').length),2);
 await dock.getByRole('button',{name:'关闭 Plugin one',exact:true}).click();
 await page.waitForFunction(()=>window.sidebarCalls.some(call=>call.command==='release_semantic_contribution'&&call.args.generation==='example.one'));
 await dock.getByRole('tab',{name:'Plugin two',exact:true}).click();
 await page.evaluate(()=>window.sidebarEnabled=false);
 await dock.getByText('此插件当前不可用。启用插件后可恢复此标签页。',{exact:true}).waitFor();
 await page.evaluate(()=>window.sidebarEnabled=true);
 await dock.getByText('Content example.two',{exact:true}).waitFor();
 assert.deepEqual(errors,[]);await page.close();
 console.log('Sidebar docking passed for both built-in kits and light/dark themes.');
} finally {await browser.close();await server.close();}
