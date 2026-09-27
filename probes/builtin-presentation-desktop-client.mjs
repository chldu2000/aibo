import '/src/app.css';
import {invoke} from '@tauri-apps/api/core';
import {appDataDir} from '@tauri-apps/api/path';
import {WebviewWindow} from '@tauri-apps/api/webviewWindow';
import {mount} from 'svelte';
import App from '/src/App.svelte';
import {until,clickButton,chooseKit,shell,rejects} from './lib/builtin-desktop-steps.mjs';

const selection=()=>invoke('get_presentation_selection');
const frame=()=>document.querySelector('.presentation-external iframe[data-presentation-revision]:not([hidden])');
const report=result=>fetch('/__builtin_native_report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(result)});
const errors=[];window.addEventListener('error',event=>errors.push(event.message));
const selected=(digest,theme)=>async()=>{const current=await selection();return current?.digest===digest&&(theme===undefined||current.themeId===theme);};

try{
  const config=await(await fetch('/__builtin_native_config')).json();const checks=[];
  const releases=await invoke('list_presentation_packages');
  const builtin=id=>releases.find(release=>release.source==='builtin'&&release.manifest.id===id);
  const material3=builtin('dev.aibo.builtin.material3'),akUi=builtin('dev.aibo.builtin.ak-ui');
  if(config.phase===0){
    if(!material3||!akUi||releases.filter(release=>release.source==='builtin').length!==2)throw Error('host did not register exactly the two built-in releases');
    checks.push('host registers both built-in releases on a fresh database');
    for(const release of [material3,akUi]){
      await rejects(()=>invoke('set_presentation_package_enabled',{digest:release.digest,enabled:false}),'builtin_presentation_immutable');
      await rejects(()=>invoke('uninstall_presentation_package',{digest:release.digest}),'builtin_presentation_immutable');
    }
    await rejects(()=>invoke('install_presentation_package',{path:config.paths.reserved}),'reserved_presentation_id');
    checks.push('built-ins cannot be disabled or uninstalled; local packages cannot claim the reserved prefix');
    const skins=[];for(const key of ['shadcn','material3'])skins.push(await invoke('install_presentation_package',{path:config.paths[key]}));
    if(skins.some(release=>release.manifest.hostApi!=='1.1.0'||release.source!=='local'))throw Error('0.4.0 packages must install as local hostApi 1.1.0 releases');
    checks.push('native installer accepts hostApi 1.1.0 packages: '+skins.map(release=>release.manifest.id+'@'+release.manifest.version).join(', '));
    if(await selection())throw Error('fresh window unexpectedly has a selection');
    // The cache left by the previous localStorage-only selector.
    localStorage.setItem('aibo.appearance.v1',JSON.stringify({kitId:'ak-ui',themeId:'dark'}));
    mount(App,{target:document.getElementById('app')});
    await until(selected(akUi.digest,'dark'),'first start records the cached kit against its release');
    await until(()=>shell()?.dataset.uiKit==='ak-ui'&&shell().dataset.uiTheme==='dark','ak-ui dark rendered');
    checks.push('first start commits the legacy cached ak-ui dark choice to the built-in release');
    await chooseKit('Aibo · Material 3');
    await until(selected(material3.digest,'dark'),'kit switch commits and keeps brightness');
    await clickButton('关闭设置');
    await clickButton('切换明暗主题');
    await until(selected(material3.digest,'light'),'brightness toggle commits the theme');
    await until(()=>shell()?.dataset.uiKit==='material3'&&shell().dataset.uiTheme==='light','material3 light rendered');
    checks.push('kit switch and titlebar brightness toggle commit to the native release store');
    const shadcn=skins[0];
    await chooseKit(shadcn.manifest.displayName,shadcn.manifest.version);
    await until(selected(shadcn.digest),'external package selection commits');
    await clickButton('关闭设置');
    await until(frame,'hostApi 1.1.0 package preflights all controls and renders in WKWebView');
    checks.push('hostApi 1.1.0 workbench package activates natively after preflighting the 1.1.0 control catalog');
    if(errors.length)throw Error(errors.join('\n'));
    await report({ok:true,phase:0,checks,expected:{shadcn:shadcn.digest,material3:material3.digest,akUi:akUi.digest}});
  }else if(config.phase===1){
    if(!(await selected(config.expected.shadcn)()))throw Error('restart lost the external selection');
    mount(App,{target:document.getElementById('app')});
    await until(frame,'restart restores the external Worker');
    checks.push('new process restores the selected hostApi 1.1.0 package');
    const fault=await invoke('install_presentation_package',{path:config.paths.runtimeFault});
    const previous=frame();
    await chooseKit(fault.manifest.displayName,fault.manifest.version);
    await until(selected(fault.digest),'faulty candidate commits before its runtime failure');
    await clickButton('关闭设置');
    await until(()=>frame()&&frame()!==previous,'faulty candidate activates a new Worker');
    await until(()=>!frame(),'runtime failure removes the external workbench');
    await until(selected(config.expected.material3,'light'),'runtime failure returns to the last built-in choice');
    await until(()=>shell()?.dataset.uiKit==='material3'&&shell().dataset.uiTheme==='light','last built-in choice rendered');
    checks.push('post-activation Worker failure returns to material3 light, the window\'s last built-in choice, instead of clearing it');
    await chooseKit('Aibo · ak-ui');
    await until(selected(config.expected.akUi,'light'),'ak-ui light committed');
    await clickButton('关闭设置');
    // A second window keeps its own selection in the same database.
    new WebviewWindow(config.secondWindowId,{url:'probes/builtin-presentation-desktop-second.html',title:'Aibo built-in probe second window',width:1000,height:760});
    const second=await until(async()=>(await(await fetch('/__builtin_native_second')).json()),'second window report',2400);
    if(!second.ok)throw Error('second window: '+second.error);
    if(!(await selected(config.expected.akUi,'light')()))throw Error('second window changed the main window selection');
    checks.push(...second.checks,'main window keeps ak-ui light while the second window selects Material 3');
    if(errors.length)throw Error(errors.join('\n'));
    await report({ok:true,phase:1,checks,expected:{dataPath:await appDataDir()}});
  }else{
    const current=releases.filter(release=>release.manifest.id==='dev.aibo.builtin.ak-ui');
    if(current.length!==1||current[0].digest!==config.expected.akUi)throw Error('rebuilt ak-ui release not registered exactly once');
    if(releases.some(release=>release.manifest.id==='dev.aibo.builtin.retired'))throw Error('retired built-in still listed');
    if(!(await selected(config.expected.akUi,'light')()))throw Error('rebuild lost the window selection or its theme');
    checks.push('host rebuild replaces the older ak-ui row and migrates the selection with its theme');
    mount(App,{target:document.getElementById('app')});
    await until(()=>shell()?.dataset.uiKit==='ak-ui'&&shell().dataset.uiTheme==='light','migrated selection rendered');
    checks.push('retired built-in rows are removed at startup');
    if(errors.length)throw Error(errors.join('\n'));
    await report({ok:true,phase:2,checks});
  }
}catch(error){await report({ok:false,error:String(error),errors,text:document.body.innerText.slice(0,3000)});}
