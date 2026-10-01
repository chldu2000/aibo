// Actual App + native IPC, with a persisted history session in an isolated application database.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {createBuiltinWorkbenchServer} from './lib/builtin-workbench-fixture.mjs';
if (process.platform !== 'darwin') throw Error('Native file link probe currently targets macOS');
const root = await mkdtemp(path.join(tmpdir(),'aibo-file-links-'));
const workspace = path.join(root,'workspace'); await mkdir(workspace);
await writeFile(path.join(workspace,'code.ts'),Array.from({length:600},(_,i)=>`const value${i+1} = ${i+1};`).join('\n'));
await writeFile(path.join(root,'outside.txt'),'outside the workspace');
const identifier = `local.aibo.filelinksprobe.${Date.now()}`;
const database = path.join(homedir(),'Library','Application Support',identifier,'development','aibo.sqlite3');
const quote = value => "'"+value.replaceAll("'","''")+"'";
let finish;
const report = new Promise(resolve => {finish=resolve;});
const server = await createBuiltinWorkbenchServer({markdown:'[定位文件](code.ts:342) · [缺失文件](missing.ts)',plugins:[{
  name:'native-file-links',enforce:'pre',
  transform(code,id) {if(id.endsWith('/src/App.svelte')) return code.replace('const runningDesktop = isTauri();','const runningDesktop = false;');},
  configureServer(server) {
    server.middlewares.use('/__file_seed',(_req,res)=>{
      try {
        execFileSync('sqlite3',[database,`PRAGMA foreign_keys=ON; INSERT INTO workspaces(id,path,label,trusted,created_at,updated_at) VALUES ('preview-workspace',${quote(workspace)},'File probe',0,'now','now'); INSERT INTO sessions(id,workspace_id,agent,label,state,created_at,updated_at) VALUES ('a','preview-workspace','history.provider','History','closed','now','now');`]);
        res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({workspace}));
      } catch(error) {res.statusCode=500;res.end(String(error));}
    });
    server.middlewares.use('/__file_report',(req,res)=>{let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{finish(JSON.parse(body));res.end('ok');});});
  },
  transformIndexHtml() {return [{tag:'script',attrs:{type:'module'},children:`
    import {invoke} from '/node_modules/@tauri-apps/api/core.js';
    const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));
    async function until(find) {for(let i=0;i<300;i++){const result=find();if(result)return result;await delay(50);}throw Error('Timed out waiting for file preview');}
    try {
      const link = await until(()=>[...document.querySelectorAll('.markdown-content a')].find(a=>a.textContent==='定位文件'));
      const response=await fetch('/__file_seed'); if(!response.ok) throw Error(await response.text());
      const {workspace}=await response.json();
      for(const args of [{sessionId:'a',path:'../outside.txt',line:null},{sessionId:'missing',path:'code.ts',line:null},{sessionId:'a',path:'.',line:null}]) {
        let denied=false;try{await invoke('read_linked_file',args);}catch{denied=true;}if(!denied)throw Error('Invalid file preview request accepted');
      }
      const absolute=await invoke('read_linked_file',{sessionId:'a',path:workspace+'/code.ts',line:342});
      if(absolute.targetLine!==342||absolute.startLine!==242)throw Error('Native absolute path/line mismatch');
      link.click();
      const row=await until(()=>document.querySelector('.file-preview-panel [data-line="342"][aria-current="true"]'));
      if(!row.textContent.includes('const value342 = 342;'))throw Error('Native file content missing');
      const line=row.getBoundingClientRect(),view=document.querySelector('.file-preview-panel pre').getBoundingClientRect();
      if(line.top<view.top||line.bottom>view.bottom)throw Error('Native requested line not scrolled into view');
      const press = label => [...document.querySelectorAll('.file-preview-panel button')].find(button=>button.textContent.trim()===label).click();
      press('上一段'); await until(()=>document.querySelector('.file-preview-line')?.dataset.line==='1');
      press('下一段'); await until(()=>document.querySelector('.file-preview-line')?.dataset.line==='401');
      press('上一段'); await until(()=>document.querySelector('.file-preview-line')?.dataset.line==='1');
      document.querySelector('[aria-label="关闭文件预览"]').click();
      await delay(100); if(document.querySelector('.file-preview-panel'))throw Error('Native preview failed to close');
      [...document.querySelectorAll('.markdown-content a')].find(a=>a.textContent==='缺失文件').click();
      const error = await until(()=>document.querySelector('.file-preview-panel [role="alert"]'));
      if(!error.textContent.trim()||error.textContent.includes('[object Object]'))throw Error('Native error is not readable');
      await fetch('/__file_report',{method:'POST',body:JSON.stringify({ok:true,checks:['session-owned native read','absolute and relative paths','workspace escape and missing session rejected','actual App line 342 visible','400-line paging','preview close','readable native errors']})});
    } catch(error) {await fetch('/__file_report',{method:'POST',body:JSON.stringify({ok:false,error:String(error.stack??error)})});}
  `}];},
}]});
await server.listen();
const config=path.join(root,'tauri.json');
await writeFile(config,JSON.stringify({identifier,build:{beforeDevCommand:'',devUrl:`http://127.0.0.1:${server.httpServer.address().port}`}}));
const child=spawn('pnpm',['tauri','dev','--no-watch','--config',config],{stdio:['ignore','pipe','pipe'],detached:true});child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);
let timer;
try {
  const result=await Promise.race([report,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Native file links probe timed out')),180000);}),new Promise((_,reject)=>child.once('exit',code=>reject(Error('Tauri exited '+code))))]);
  console.log(JSON.stringify(result));assert.equal(result.ok,true,result.error);
} finally {
  clearTimeout(timer);const exited=child.exitCode!==null||child.signalCode!==null?Promise.resolve():new Promise(resolve=>child.once('exit',resolve));
  try{process.kill(-child.pid,'SIGTERM');}catch{}
  await exited;await server.close();await rm(root,{recursive:true,force:true});
}
