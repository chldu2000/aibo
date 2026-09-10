import '/src/app.css';
import { invoke } from '@tauri-apps/api/core';
import { mount, tick } from 'svelte';
import App from '/src/App.svelte';
import { setUiKit } from '/src/lib/ui-kit/registry.ts';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(find,label) {for(let n=0;n<300;n++){const value=find();if(value)return value;await delay(50);}throw Error(`timeout: ${label}`);}
const button=label=>Array.from(document.querySelectorAll('button')).find(node=>node.textContent.trim()===label&&!node.disabled);
const report=result=>fetch('/__semantic_native_report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(result)});
try {
  const {workspacePath}=await (await fetch('/__semantic_native_config')).json();
  const workspace=await invoke('add_workspace',{path:workspacePath});
  mount(App,{target:document.getElementById('app')});
  const row=await until(()=>Array.from(document.querySelectorAll('button')).find(node=>node.getAttribute('aria-label')?.startsWith(workspace.label+'，')),'workspace row');row.click();
  await tick();
  window.dispatchEvent(new KeyboardEvent('keydown',{key:'k',metaKey:true,bubbles:true}));
  const command=await until(()=>Array.from(document.querySelectorAll('.command-palette-list button')).find(node=>node.textContent.includes('工作区变更（只读）')&&!node.disabled),'semantic command');command.click();
  const evidence=[];
  for(const kit of ['shadcn','material3']) {
    setUiKit(kit);await tick();
    for(const layout of ['central','sidebar']) {
      if(layout==='sidebar'){(await until(()=>button('切换侧栏布局'),'sidebar toggle')).click();await tick();}
      const inspect=await until(()=>document.querySelector('button[data-item="worktree:one.txt"]:not(:disabled)'),'real Git file');inspect.click();
      const diff=await until(()=>document.querySelector('textarea[aria-label="文件差异内容"]'),'native diff');
      if(!diff.value.includes('AIBO_NATIVE_SEMANTIC_OK'))throw Error('unexpected native Git diff');
      (await until(()=>button('返回变更列表'),'back')).click();await tick();
      await until(()=>document.querySelector('button[data-item="worktree:one.txt"]:not(:disabled)'),'restored list');
      evidence.push({kit,layout,source:'native WebView -> Tauri command -> real temporary Git repository',diff:'passed'});
    }
    (await until(()=>button('切换中央布局'),'central toggle')).click();await tick();
  }
  (await until(()=>button('插件'),'plugin management')).click();
  await until(()=>!document.querySelector('.semantic-workbench'),'management remains reachable');
  const sessions=await invoke('list_sessions',{workspaceId:workspace.id});
  if(sessions.length!==0)throw Error('semantic view must not create Agent sessions');
  await report({ok:true,evidence,sessions:sessions.length,interaction:'scripted native DOM clicks; physical keyboard and screen reader not claimed'});
} catch(error) {await report({ok:false,error:String(error),text:document.body.innerText.slice(0,2000)});}
