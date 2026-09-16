import '/src/app.css';
import { mount, unmount } from 'svelte';
import { get } from 'svelte/store';
import { setUiKit, activeThemeStyle } from '/src/lib/ui-kit/registry.ts';
import Probe from './AgentSettingsProbe.svelte';
let instance;
window.mountSettingsProbe=async kit=>{
  if(instance)await unmount(instance);
  setUiKit(kit);
  document.body.classList.add('app-shell');
  document.body.dataset.uiKit=kit;
  document.body.style.cssText=get(activeThemeStyle)+';background:var(--aibo-bg);color:var(--aibo-text);font-family:system-ui;height:auto;min-height:100vh;overflow:auto';
  instance=mount(Probe,{target:document.getElementById('probe')});
};
