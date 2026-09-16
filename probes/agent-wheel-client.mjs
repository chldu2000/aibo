import '/src/app.css';
import { mount, unmount } from 'svelte';
import { get } from 'svelte/store';
import { setUiKit, activeThemeStyle } from '/src/lib/ui-kit/registry.ts';
import Probe from './AgentWheelProbe.svelte';
let component;
window.agentWheelProbe = {
  async render(kit) {
    if (component) await unmount(component);
    setUiKit(kit);
    document.body.dataset.uiKit = kit;
    document.body.style.cssText = get(activeThemeStyle) + ';padding:160px;width:720px';
    component = mount(Probe, { target: document.getElementById('probe') });
  },
  setInstallations(value) { component.setInstallations(value); },
  calls() { return component.calls; },
};
