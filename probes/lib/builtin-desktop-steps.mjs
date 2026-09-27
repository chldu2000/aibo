// DOM steps shared by the native built-in presentation probe windows.
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function until(find,label,attempts=600){for(let n=0;n<attempts;n++){const value=await find();if(value)return value;await delay(50);}throw Error('timeout: '+label);}
export const shell=()=>document.querySelector('.app-shell');
const usable=node=>node&&!node.disabled&&!node.closest('[inert]');
/** Buttons are matched by accessible name, or its prefix when the name carries live state. */
export async function clickButton(name){
  const button=await until(()=>[...document.querySelectorAll('button')].find(node=>usable(node)&&(node.getAttribute('aria-label')===name||node.textContent.trim()===name)),name);
  button.click();
}
export async function openSettings(){
  if(document.querySelector('.appearance-kit-option'))return;
  (await until(()=>[...document.querySelectorAll('button[aria-label^="打开工作台设置"]')].find(usable),'open workbench settings')).click();
}
/** Kit options show the label in <strong> and the description (a release version for packages) in <small>. */
export async function chooseKit(label,description){
  await openSettings();
  const option=await until(()=>[...document.querySelectorAll('.appearance-kit-option')].find(node=>usable(node)
    &&node.querySelector('strong')?.textContent.trim()===label&&(description===undefined||node.querySelector('small')?.textContent.trim()===description)),'kit option '+label);
  option.click();
}
export async function rejects(operation,code){
  try{await operation();}catch(error){if(String(error).includes(code))return;throw Error(`expected ${code}, got ${error}`);}
  throw Error(`expected ${code}, but the operation succeeded`);
}
