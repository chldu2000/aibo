import '/src/app.css';
import {invoke} from '@tauri-apps/api/core';
import {mount} from 'svelte';
import App from '/src/App.svelte';
import {until,chooseKit,shell} from './lib/builtin-desktop-steps.mjs';

const report=result=>fetch('/__builtin_native_second',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(result)});
try{
  const releases=await invoke('list_presentation_packages');
  const builtin=id=>releases.find(release=>release.source==='builtin'&&release.manifest.id===id);
  if(await invoke('get_presentation_selection'))throw Error('a new window must not inherit another window\'s committed selection');
  // A new window starts from the shared first-paint cache and records it for itself.
  const cached=JSON.parse(localStorage.getItem('aibo.appearance.v1')||'null');
  const kit=cached?.kitId??'material3';
  mount(App,{target:document.getElementById('app')});
  const first=await until(async()=>await invoke('get_presentation_selection'),'second window records its own selection');
  if(first.digest!==builtin('dev.aibo.builtin.'+kit).digest)throw Error('second window recorded '+JSON.stringify(first)+' instead of cached '+kit);
  await chooseKit('Aibo · Material 3');
  await until(async()=>(await invoke('get_presentation_selection'))?.digest===builtin('dev.aibo.builtin.material3').digest,'second window selects Material 3');
  await until(()=>shell()?.dataset.uiKit==='material3','second window renders Material 3');
  await report({ok:true,checks:[`second window starts with no selection and records the cached ${kit} kit for itself`,'second window commits Material 3 independently']});
}catch(error){await report({ok:false,error:String(error),text:document.body.innerText.slice(0,2000)});}
