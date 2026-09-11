import '/src/app.css';
import { mount } from 'svelte';
import { invoke } from '@tauri-apps/api/core';
import App from '/src/App.svelte';
import { setUiKit } from '/src/lib/ui-kit';

const pause = ms => new Promise(resolve => setTimeout(resolve,ms));
async function until(read) { const end = Date.now()+20000; while(Date.now()<end) { if(read())return; await pause(40); } throw Error('Native UI state timeout'); }
const button = label => document.querySelector(`button[aria-label="${label}"]`);
try {
 const {workspacePath} = await (await fetch('/__native_config')).json();
 await invoke('add_workspace',{path:workspacePath});
 mount(App,{target:document.getElementById('app')});
 await until(() => button('恢复默认呈现') && !document.querySelector('[aria-busy="true"].workbench-presentation'));
 const results = [], recoveries = [];
 for(const kit of ['shadcn','material3']) {
  setUiKit(kit); button('恢复默认呈现').click();
  for(const layout of ['standard','review','focus']) {
   if(layout==='review') button('交换工作台侧边区域').click();
   if(layout==='focus') button('切换工作台呈现').click();
   await until(() => document.querySelector('[data-presentation-layout]')?.dataset.presentationLayout === layout && !document.querySelector('.workbench-presentation').inert);
   const response = await fetch('/__native_ax'); const result = await response.json();
   if(!response.ok) throw Error(result.error);
   results.push({kit,layout,...result});
  }
  const response = await fetch('/__native_ax?restore=1'); const recovery = await response.json();
  if(!response.ok || !recovery.nativeRecoveryPressed) throw Error('Native recovery did not execute');
  await until(() => document.querySelector('[data-presentation-layout]')?.dataset.presentationLayout === 'standard');
  recoveries.push({kit,nativeRecoveryPressed:true,standardRestored:true});
 }
 await fetch('/__native_report',{method:'POST',body:JSON.stringify({ok:true,realWorkspace:true,results,recoveries})});
} catch(error) { await fetch('/__native_report',{method:'POST',body:JSON.stringify({ok:false,error:String(error)})}); }
