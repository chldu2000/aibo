import '/src/app.css';
import { mount, unmount } from 'svelte';
import { get } from 'svelte/store';
import { setUiAppearance, activeThemeStyle } from '/src/lib/ui-kit/registry.ts';
import { language } from '/src/lib/i18n/runtime.ts';
import Probe from './AgentSettingsProbe.svelte';
let instance;
window.mountSettingsProbe=async (kit,theme='light')=>{
  if(instance)await unmount(instance);
  setUiAppearance({kitId:kit,themeId:theme});
  language.set({preference:'zh-CN',locale:'zh-CN'});
  document.body.classList.add('app-shell');
  document.body.dataset.uiKit=kit;
  document.body.style.cssText=get(activeThemeStyle)+';background:var(--aibo-bg);color:var(--aibo-text);font-family:system-ui;height:auto;min-height:100vh;overflow:auto';
  instance=mount(Probe,{target:document.getElementById('probe')});
};
