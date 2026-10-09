import '/src/app.css';
import {invoke} from '@tauri-apps/api/core';
import {mount,tick} from 'svelte';
import App from '/src/App.svelte';
import {language} from '/src/lib/i18n/runtime.ts';
import {toErrorText} from '/src/lib/app/error-utils.ts';
import {translateMessage} from '/packages/i18n/index.js';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(find,label){for(let n=0;n<300;n++){const value=await find();if(value)return value;await delay(50);}throw Error(`timeout: ${label}`);}
const evidence=[];
try {
  const {workspacePath}=await(await fetch('/__search_native_config')).json();
  const workspace=await invoke('add_workspace',{path:workspacePath});
  const request={query:'原生全局搜索',kind:'file',workspaceId:workspace.id,limit:50};
  const files=await invoke('search_global_files',{request,requestId:'native-initial'});
  if(files.items.length!==1||files.items[0].target.id!=='one.txt')throw Error('native file search did not return owned UTF-8 content');
  const detail=await invoke('read_search_result',{target:files.items[0].target});
  if(!detail.content.includes('原生全局搜索正文'))throw Error('native detail missing content');
  const ignored=await invoke('search_global_files',{request:{...request,query:'AIBO_IGNORED_SEARCH_TEXT'},requestId:'native-ignored'});
  if(ignored.items.length)throw Error('ignored file indexed');
  const catalog=await invoke('search_global',{request:{...request,query:'workspace',kind:'workspace'}});
  if(!catalog.items.some(item=>item.target.id===workspace.id))throw Error('native workspace index missing');
  evidence.push({nativeFileSearch:true,ignoreRules:true,nativePreview:true,nativeWorkspaceIndex:true});
  for(const [id,key,zh,en] of [
    ['binary.dat','binaryPreview','二进制文件不提供文本预览','Text previews are unavailable for binary files.'],
    ['invalid.dat','notUtf8','文件不是 UTF-8 文本','This file is not UTF-8 text.'],
  ]) {
    let failure;
    try { await invoke('read_search_result',{target:{source:'file',id,workspaceId:workspace.id}}); } catch(error) { failure=error; }
    if(failure?.code!=='session_operation_error'||failure.message!==`session operation failed: ${zh}`||failure.localized?.key!==`native.search.${key}`)throw Error('native read error lost legacy diagnostic or explicit metadata: '+JSON.stringify(failure));
    const message=toErrorText(failure);
    if(translateMessage('en',message)!==en||translateMessage('zh-CN',message)!==zh)throw Error('native IPC read error cannot switch languages');
    evidence.push({nativeReadError:id,codePreserved:true,diagnosticPreserved:true,english:en,chinese:zh});
  }
  localStorage.setItem('aibo.language.v1','zh-CN');
  language.set({preference:'zh-CN',locale:'zh-CN'});
  mount(App,{target:document.getElementById('app')});
  await until(()=>document.querySelector('[aria-label="全局搜索"]'),'host search entry');
  for(let n=0;n<2;n++)for(const type of ['keydown','keyup'])window.dispatchEvent(new KeyboardEvent(type,{key:'Shift',bubbles:true}));
  const input=await until(()=>document.querySelector('#global-search-input'),'double Shift dialog');
  if(document.activeElement!==input)throw Error('WebView search did not take focus');
  input.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));await tick();
  if(document.querySelector('.global-search-categories [aria-pressed="true"]')?.textContent.trim()!=='工作区'||document.activeElement!==input)throw Error('Tab did not select workspace and retain input focus');
  input.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}));await tick();
  if(document.querySelector('.global-search-categories [aria-pressed="true"]')?.textContent.trim()!=='全部')throw Error('Shift+Tab did not select all types');
  input.value='原生全局搜索';input.dispatchEvent(new Event('input',{bubbles:true}));
  const result=await until(()=>Array.from(document.querySelectorAll('.global-search-result')).find(node=>node.textContent.includes('one.txt')),'native-backed UI result');
  result.click();await until(()=>document.querySelector('.global-search-preview pre')?.textContent.includes('原生全局搜索正文'),'native-backed preview');
  document.querySelector('[aria-label="关闭全局搜索"]').click();await tick();
  if(document.querySelector('dialog.global-search'))throw Error('WebView dialog failed to close');
  evidence.push({webview:'WKWebView',syntheticDoubleShift:true,syntheticTabTypeCycling:true,nativeBackedUiSearch:true,previewAndClose:true});
  await fetch('/__search_native_report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ok:true,evidence})});
}catch(error){await fetch('/__search_native_report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ok:false,error:String(error.stack??error),evidence})});}
