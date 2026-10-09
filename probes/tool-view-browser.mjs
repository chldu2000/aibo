import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {readFile,mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {tmpdir} from 'node:os';
import path from 'node:path';
const root=await mkdtemp(path.join(tmpdir(),'aibo-terminal-browser-'));await mkdir(path.join(root,'settings'));
const executable=path.resolve('../aibo-plugins/dist/terminal/terminal');
const child=spawn(executable,[],{cwd:root,env:{...process.env,AIBO_TOOL_SETTINGS:path.join(root,'settings')},stdio:['pipe','pipe','pipe']});
const pending=[];createInterface({input:child.stdout}).on('line',line=>{const item=pending.shift();if(!item)return;const value=JSON.parse(line);value.error?item.reject(Error(value.error)):item.resolve(value.result);});
let queue=Promise.resolve();
const call=(method,params=null)=>{const result=queue.then(()=>new Promise((resolve,reject)=>{pending.push({resolve,reject});child.stdin.write(JSON.stringify({protocol:'aibo.tool-view/1',method,params})+'\n');}));queue=result.catch(()=>{});return result;};
await call('initialize',{workspacePath:root});await call('request',{action:'settings',settings:{path:'/bin/sh',args:[]}});
const html=await readFile('../aibo-plugins/dist/terminal/frontend.html','utf8');
const csp="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src data:; font-src data:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const server=await createServer({server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false,watch:null},plugins:[{name:'terminal-document',configureServer(server){server.middlewares.use((req,res,next)=>{if(req.url!=='/terminal-document')return next();res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Content-Security-Policy',csp);res.end(html);});}}]});await server.listen();
const browser=await chromium.launch({headless:true});const evidence=[];
try {
 const page=await browser.newPage({locale:'en-US',viewport:{width:1100,height:780}});const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});page.on('console',m=>{if(m.type()==='error')console.error(m.text());});
 await page.exposeFunction('toolNativeRequest',payload=>call('request',payload));
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/probes/tool-view.html`);await page.waitForFunction(()=>window.toolViewProbe);
 for(const kit of ['material3','shadcn']) {
  console.log('Testing',kit);
  await page.evaluate(kit=>window.toolViewProbe.mount(kit),kit);
  let frame=page.frameLocator('iframe');await frame.getByRole('tab').first().waitFor({timeout:10000}).catch(async error=>{await page.screenshot({path:'/tmp/aibo-terminal-failure.png'});console.error(await page.locator('body').innerText());console.error(await frame.locator('body').innerText());throw error;});
  await page.evaluate(() => { window.initialToolFrame = document.querySelector('iframe'); });
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => window.initialToolFrame === document.querySelector('iframe')),true,'host refresh must preserve the terminal iframe');
  const terminal=frame.locator('.terminal:not([hidden]) textarea');await terminal.focus();
  await page.keyboard.type("printf '\\nBROWSER_%s\\n' OK",{delay:20});await page.keyboard.press('Enter');
  await frame.locator('.terminal:not([hidden]) .xterm-rows').getByText('BROWSER_OK',{exact:true}).waitFor();
  assert.equal(await page.locator('iframe').getAttribute('sandbox'),'allow-scripts');
  const isolation=await frame.locator('body').evaluate(()=>{try{void parent.document;return false;}catch{return true;}});assert(isolation);
  await frame.getByRole('button',{name:'＋ New',exact:true}).click();await frame.getByRole('tab').nth(1).waitFor();
  assert.equal(await frame.getByRole('tab').count(),2);
  await frame.getByRole('button',{name:'Close terminal',exact:true}).click();await frame.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(await frame.getByRole('tab').count(),2);
  await frame.getByRole('button',{name:'Close terminal',exact:true}).click();await frame.getByRole('button',{name:'End terminal',exact:true}).click();await frame.getByRole('tab').nth(1).waitFor({state:'detached'});
  await page.getByRole('button',{name:/Reload view|重新加载视图/}).click();await frame.getByRole('tab').first().waitFor();
  await frame.locator('.terminal:not([hidden]) .xterm-rows').getByText('BROWSER_OK',{exact:true}).first().waitFor();
  await frame.locator('.terminal:not([hidden]) textarea').focus();await page.keyboard.type('sleep 90');await page.keyboard.press('Enter');
  // Wait until the OS assigns the job its foreground group, rather than interrupting the shell's fork/exec transition.
  let foreground=false;for(let i=0;i<100;i++){const state=await call('request',{action:'list'});foreground=state.terminals.some(t=>t.foreground&&t.pid!==t.foreground);if(foreground)break;await page.waitForTimeout(20);}if(!foreground)console.error('FRAME',await frame.locator('body').innerText());assert(foreground,'sleep became the foreground job');
  await page.keyboard.press('Control+c');await page.waitForTimeout(100);
  await page.keyboard.type("printf '\\nAFTER_%s\\n' INTERRUPT");await page.keyboard.press('Enter');await frame.locator('.xterm-rows').getByText('AFTER_INTERRUPT',{exact:true}).first().waitFor();
  if(kit==='material3') {
    await frame.locator('.terminal:not([hidden]) textarea').focus();
    await page.keyboard.type("printf '\\n%s\\n' '");await page.keyboard.insertText('终端中文');await page.keyboard.type("'");await page.keyboard.press('Enter');
    await frame.locator('.xterm-rows').getByText('终端中文',{exact:true}).last().waitFor();
    await page.keyboard.type('vim -Nu NONE -i NONE');await page.keyboard.press('Enter');
    await frame.locator('.xterm-rows').getByText('VIM - Vi IMproved',{exact:false}).waitFor();
    await page.keyboard.type('iFULLSCREEN_OK');await frame.locator('.xterm-rows').getByText('FULLSCREEN_OK',{exact:false}).waitFor();
    await page.keyboard.press('Escape');await page.keyboard.type(':q!');await page.keyboard.press('Enter');
    await page.keyboard.type("printf '\\nAFTER_%s\\n' VIM");await page.keyboard.press('Enter');await frame.locator('.xterm-rows').getByText('AFTER_VIM',{exact:true}).waitFor();
  }
  evidence.push({kit,chineseInput:kit==='material3',vim:kit==='material3',realPty:true,stableFrame:true,keyboard:true,multipleTabs:true,cancelClose:true,reconnect:true,ctrlC:true,opaqueOrigin:true});
 }
 await page.screenshot({path:'/tmp/aibo-terminal-browser.png'});assert.deepEqual(errors,[]);
 await writeFile('/tmp/aibo-terminal-browser.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
} finally {await call('shutdown').catch(()=>{});child.stdin.end();await browser.close();await server.close();await rm(root,{recursive:true,force:true});}
