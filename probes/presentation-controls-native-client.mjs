// Runs inside the isolated WKWebView. Host-side checks here; real input comes from the native helper.
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(find,label,attempts=200){for(let n=0;n<attempts;n++){const value=await find();if(value)return value;await delay(50);}throw Error('timeout: '+label);}
const input=async body=>{const response=await fetch('/__native_input',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const result=await response.json();if(!result.ok)throw Error('native input failed: '+result.error);await delay(120);};
const clickAt=(element,fx=.5,fy=.5)=>{const r=element.getBoundingClientRect();return input({action:'click',x:r.left+r.width*fx,y:r.top+r.height*fy,width:innerWidth,height:innerHeight});};
const key=name=>input({action:'key',key:name});
const probe=()=>window.controlPackageProbe;
const results=()=>probe().result();
const frames=selector=>[...document.querySelectorAll(selector)].filter(frame=>!frame.closest('[hidden]'));
const listbox=label=>[...document.querySelectorAll('[role="listbox"]')].find(node=>node.getAttribute('aria-label')===label&&node.matches(':popover-open'));
const box=element=>{const r=element.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
const report=result=>fetch('/__controls_native_report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(result)});
const errors=[];window.addEventListener('error',event=>errors.push(event.message));
try{
  const {packages}=await(await fetch('/__controls_native_config')).json();
  await until(()=>probe(),'harness mounted');
  const defaults=[...document.querySelectorAll('#selects .ui-select, #selects .context-window-select')].map(box);
  const checks=[],observations=[];
  for(const pkg of packages){
    const name=pkg.release.manifest.id.split('.').at(-1);
    await probe().select(pkg);
    const [select,context]=await until(()=>{const found=frames('#selects .external-control iframe');return found.length===2&&found;},name+': select triggers replaced after WebKit preflight');
    await until(()=>frames('#marks .external-control iframe').length===3,name+': marks replaced');
    await delay(400);
    const replaced=[select,context].map(frame=>box(frame.parentElement));
    replaced.forEach((frame,i)=>{if(Math.abs(frame.width-defaults[i].width)>1||Math.abs(frame.height-defaults[i].height)>1)throw Error(`${name}: footprint ${JSON.stringify(frame)} differs from default ${JSON.stringify(defaults[i])}`);});
    checks.push(name+': package preflights the 1.1.0 catalog in WKWebView and select replacements keep the default footprint');

    const before=results().length;
    await clickAt(select);
    const menu=await until(()=>listbox('Probe select'),name+': real click inside the frame opens the host menu');
    const menuBox=box(menu),frameBox=box(select);
    if(!(menuBox.height>frameBox.height&&menuBox.top>=frameBox.bottom-1))throw Error(`${name}: menu ${JSON.stringify(menuBox)} is not outside frame ${JSON.stringify(frameBox)}`);
    await until(()=>document.activeElement?.getAttribute('role')==='listbox',name+': host menu takes focus from the frame');
    checks.push(name+': trusted click in the isolated frame opens a host menu outside it and moves focus to the menu');
    await key('ArrowDown');await key('Enter');
    await until(()=>results().length===before+1,name+': keyboard choice commits');
    if(JSON.stringify(results().at(-1))!=='["select","b"]')throw Error(name+': unexpected choice '+JSON.stringify(results().at(-1)));
    await until(()=>!listbox('Probe select'),name+': menu closes after choice');
    await until(()=>document.activeElement===select,name+': focus returns to the select frame');
    checks.push(name+': ArrowDown and Enter commit through the host and return focus to the frame');
    await clickAt(select);await until(()=>listbox('Probe select'),name+': reopen');
    await key('Escape');
    await until(()=>!listbox('Probe select'),name+': Escape closes');
    await until(()=>document.activeElement===select,name+': focus returns after Escape');
    if(results().length!==before+1)throw Error(name+': Escape must not choose');
    checks.push(name+': Escape closes without choosing and returns focus');

    await clickAt(context,.8);
    const contextMenu=await until(()=>listbox('模型上下文大小'),name+': context trigger opens its host menu');
    const option=[...contextMenu.querySelectorAll('[role="option"]')].find(node=>node.textContent.includes('1M'));
    await clickAt(option);
    await until(()=>JSON.stringify(results().at(-1))==='["context","max"]',name+': pointer choice in the host menu commits');
    checks.push(name+': context trigger and pointer choice in the host menu commit');

    const rowMark=frames('#replaceable button .status-mark iframe')[0];
    const count=results().length;
    await clickAt(rowMark);
    await until(()=>results().length===count+1&&JSON.stringify(results().at(-1))==='["row"]',name+': click on a decorative mark reaches its parent button');
    if(rowMark.getAttribute('tabindex')!=='-1')throw Error(name+': decorative frame is focusable');
    checks.push(name+': decorative mark lets real clicks reach the parent and stays out of Tab order');

    // Assistive technology activates web buttons with AXPress; record whether the sandbox accepts it.
    await probe().setChoice('a');
    await until(()=>frames('#selects .external-control iframe').length===2,name+': trigger refreshed');
    const axStart=results().length;
    const pressed=await fetch('/__native_input',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'axpress',name:'Probe select：Alpha'})}).then(response=>response.json());
    let opened=false;
    if(pressed.ok){for(let n=0;n<40&&!opened;n++){opened=Boolean(listbox('Probe select'));await delay(50);}}
    observations.push({skin:name,axpress:pressed.ok?(opened?'opened the host menu':'reached the button but the sandbox ignored it'):'button not exposed: '+pressed.error});
    if(opened){await key('Escape');await until(()=>!listbox('Probe select'),name+': close AX menu');}
    if(results().length!==axStart)throw Error(name+': AXPress must not choose');
  }
  await probe().dispose();
  if(errors.length)throw Error(errors.join('\n'));
  await report({ok:true,checks,observations});
}catch(error){await report({ok:false,error:String(error),errors,text:document.body.innerText.slice(0,2000)});}
