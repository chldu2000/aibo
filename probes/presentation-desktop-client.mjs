import '/src/app.css';
import {invoke} from '@tauri-apps/api/core';
import {mount} from 'svelte';
import App from '/src/App.svelte';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(find,label){for(let n=0;n<400;n++){const value=await find();if(value)return value;await delay(50);}throw Error('timeout: '+label);}
const button=label=>[...document.querySelectorAll('button')].find(node=>(node.textContent.replace(/\s+/g,'')===label.replace(/\s+/g,'')||node.getAttribute('aria-label')===label)&&!node.disabled&&!node.closest('[inert]'));
const click=async label=>(await until(()=>button(label),label)).click();
const selection=()=>invoke('get_presentation_selection');
const frame=()=>document.querySelector('.presentation-external iframe[data-presentation-revision]');
const report=result=>fetch('/__presentation_native_report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(result)});
let layoutStorageKey;
const storedLayout=()=>JSON.parse(localStorage.getItem(layoutStorageKey)||'null');
const errors=[];window.addEventListener('error',event=>errors.push(event.message));
try{
 const config=await(await fetch('/__presentation_native_config')).json();const checks=[];layoutStorageKey='aibo.workbench-layout.v1.'+encodeURIComponent(config.probeWindowId);
 if(config.phase===0){
  const workspace=await invoke('add_workspace',{path:config.workspacePath});
  const releases=[];for(const path of config.paths)releases.push(await invoke('install_presentation_package',{path}));
  if(await selection())throw Error('install unexpectedly activated a skin');
  checks.push('native installs do not activate');mount(App,{target:document.getElementById('app')});
  const navigationSplitter=await until(()=>document.querySelector('button[aria-label^="调整工作区与会话宽度"]'),'default navigation splitter');
  navigationSplitter.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
  await until(()=>storedLayout()?.navigationWidth===276,'host stores navigation width');
  const auxiliarySplitter=await until(()=>document.querySelector('button[aria-label^="调整会话与侧边栏宽度"]'),'default auxiliary splitter');
  auxiliarySplitter.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));
  await until(()=>storedLayout()?.auxiliaryWidth===336,'host stores auxiliary width');
  checks.push('default host resize persists both widths in native WebView storage');
  await click('打开设置');
  for(const release of releases.slice(0,3)){
   await click(release.manifest.displayName+' '+release.manifest.version);
   await until(async()=> (await selection())?.digest===release.digest,'native selection commit');
   await click('完成');await until(frame,'native Worker rendered');checks.push('activate '+release.manifest.id+'@'+release.manifest.version);await click('打开设置');
  }
  const expected=releases[2].digest;
  await click(releases[3].manifest.displayName+' '+releases[3].manifest.version);
  await until(()=>document.body.innerText.includes('native_candidate_failure'),'failed candidate reported');
  if((await selection())?.digest!==expected)throw Error('failed candidate replaced previous selection');
  checks.push('failed candidate preserves native selected release');
  await click('完成');await until(frame,'old workbench remains rendered');
  if(errors.length)throw Error(errors.join('\n'));
  await report({ok:true,phase:config.phase,checks,selection:await selection(),workspaceId:workspace.id,layout:storedLayout()});
 }else{
  if(JSON.stringify(storedLayout())!==JSON.stringify(config.expected.layout))throw Error('native restart lost host layout');
  checks.push('new process retains host layout storage');
  if((await selection())?.digest!==config.expected.digest)throw Error('restart lost selection');
  const release=await invoke('read_presentation_package',{digest:config.expected.digest});if(release.release.manifest.version!=='0.2.1')throw Error('restart loaded wrong version');
  mount(App,{target:document.getElementById('app')});await until(frame,'startup restores real Worker');checks.push('new process restores installed upgraded release');
  const runtimeRelease=await invoke('install_presentation_package',{path:config.runtimeFault});
  const previousFrame=frame();await click('打开设置');await click('shadcn-svelte 0.2.3');
  await until(async()=> (await selection())?.digest===runtimeRelease.digest,'runtime candidate commits before fault');
  await click('完成');await until(()=>frame()&&frame()!==previousFrame,'runtime candidate activates new real Worker');
  await until(()=>!frame(),'running Worker fault restores default host');
  await until(async()=> !(await selection()),'runtime fault clears persisted native selection');
  checks.push('post-activation Worker infinite loop falls back and clears native selection');
  await click('打开设置');await click('shadcn-svelte 0.2.1');await click('完成');await until(frame,'fixed settings can reactivate healthy package after runtime fault');
  checks.push('fixed host settings remain usable and healthy release reactivates after runtime failure');

  await invoke('set_presentation_package_enabled',{digest:config.expected.digest,enabled:false});
  await until(()=>!frame(),'disabled active skin falls back');if(await selection())throw Error('disable retained selection');checks.push('native disable clears selection and App falls back');
  await until(()=>document.querySelector(`button[aria-label="调整工作区与会话宽度，当前 ${config.expected.layout.navigationWidth} 像素"]`),'restored navigation width in default host');
  await until(()=>document.querySelector(`button[aria-label="调整会话与侧边栏宽度，当前 ${config.expected.layout.auxiliaryWidth} 像素"]`),'restored auxiliary width in default host');
  checks.push('fallback after restart renders persisted host column widths');
  await invoke('set_presentation_package_enabled',{digest:config.expected.digest,enabled:true});await delay(2300);await click('打开设置');await click('shadcn-svelte 0.2.1');await click('完成');await until(frame,'reenabled skin activates');
  await invoke('uninstall_presentation_package',{digest:config.expected.digest});await until(()=>!frame(),'uninstall falls back');if(await selection())throw Error('uninstall retained selection');
  const workspaces=await invoke('list_workspaces');if(!workspaces.some(workspace=>workspace.id===config.expected.workspaceId))throw Error('skin lifecycle removed workspace');
  checks.push('uninstall clears selection and retains workspace');if(errors.length)throw Error(errors.join('\n'));
  await report({ok:true,phase:config.phase,checks});
 }
}catch(error){await report({ok:false,error:String(error),errors,text:document.body.innerText.slice(0,4000)});}
