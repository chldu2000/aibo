import '/src/app.css';
import { mount, unmount } from 'svelte';
import { get } from 'svelte/store';
import { setUiKit, activeThemeStyle } from '/src/lib/ui-kit/registry.ts';
import PluginManagerPanel from '/src/lib/components/app/PluginManagerPanel.svelte';
import baseView from '/fixtures/plugins/platform-v2/declarative.json';
const view = structuredClone(baseView); view.contributions[0].contractVersion = '2.0.0';
import parent from '/fixtures/plugins/platform-v2/dependent.json';
import echo from '/fixtures/plugins/echo-agent/plugin.json';
let component;
const calls = [];
window.manifestProbe = { calls, async render(kit) {
  if (component) await unmount(component);
  setUiKit(kit); document.body.dataset.uiKit = kit;
  document.body.style.cssText = get(activeThemeStyle) + ';padding:32px';
  component = mount(PluginManagerPanel, { target: document.getElementById('probe'), props: {
    installations: [
      { id:'view',pluginId:view.pluginId,pluginVersion:'1.0.0',installed:true,enabled:false,runnable:false,dependencies:[],manifest:view,activationIssues:['插件已登记；此版本尚未支持语义合同 2.0.0。'] },
      { id:'parent',pluginId:parent.pluginId,pluginVersion:'1.0.0',installed:true,enabled:false,runnable:true,dependencies:[],manifest:parent,activationIssues:[],packageDependencies:{dependencies:[{pluginId:'dev.aibo.capability-echo',required:false,available:false,version:'1.0.0',issue:'dependency_unavailable',contributionIds:['dev.aibo.capability-parent.optional']}],unavailableContributions:['dev.aibo.capability-parent.optional']} },
      { id:'echo',pluginId:echo.pluginId,pluginVersion:'1.0.0',installed:true,enabled:true,runnable:true,dependencies:[],manifest:echo,activationIssues:[] },
    ], packagePath:'',busy:false,onPackagePathChange(){},onInstall(){},
    onEnabledChange:(...args)=>calls.push(['enable',...args]),onUninstall:(...args)=>calls.push(['uninstall',...args]),onCreateSession:(...args)=>calls.push(['create',...args]),
  }});
}};
