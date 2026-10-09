import type { SidebarTarget, SidebarTab, SidebarPane, SidebarLayout, SidebarOperation } from '../../../packages/plugin-protocol/src/presentation-layout';
export type { SidebarTarget, SidebarTab, SidebarPane, SidebarLayout, SidebarOperation } from '../../../packages/plugin-protocol/src/presentation-layout';

export const sidebarTabId = (target: SidebarTarget): string => target.kind === 'plugin'
  ? JSON.stringify(['plugin', target.installationId, target.contributionId]) : target.kind;
const pane = (id: string, tabs: string[] = []): SidebarPane => ({ id, tabs, active: tabs[0] ?? null, floating: false, x: 100, y: 100, width: 440, height: 520 });
export const defaultSidebarLayout = (): SidebarLayout => ({ tabs: [{ id: 'git', target: { kind: 'git' } }, { id: 'context', target: { kind: 'context' } }], panes: [pane('main', ['git', 'context'])], activePane: 'main' });

function tidy(layout: SidebarLayout): SidebarLayout {
  layout.panes = layout.panes.filter(value => value.tabs.length > 0 || value.id === 'main');
  for (const value of layout.panes) if (!value.tabs.includes(value.active ?? '')) value.active = value.tabs[0] ?? null;
  if (!layout.panes.some(value => value.id === layout.activePane)) layout.activePane = 'main';
  return layout;
}

/** Every layout intent is atomic. A content identity occurs at most once in a session. */
export function changeSidebarLayout(previous: SidebarLayout, operation: SidebarOperation): SidebarLayout {
  const layout = structuredClone(previous);
  const find = (id: string) => layout.panes.find(value => value.tabs.includes(id));
  const remove = (id: string) => {
    const owner = find(id);
    if (!owner) return;
    const index = owner.tabs.indexOf(id);
    owner.tabs = owner.tabs.filter(value => value !== id);
    if (owner.active === id) owner.active = owner.tabs[Math.min(index, owner.tabs.length - 1)] ?? null;
  };
  if (operation.kind === 'open') {
    const id = sidebarTabId(operation.target);
    let owner = find(id);
    if (!owner) {
      owner = layout.panes.find(value => value.id === operation.paneId) ?? layout.panes.find(value => value.id === layout.activePane && !value.floating) ?? layout.panes[0];
      layout.tabs.push({ id, target: operation.target }); owner.tabs.push(id);
    }
    owner.active = id; layout.activePane = owner.id;
  } else if (operation.kind === 'bounds') {
    const owner = layout.panes.find(value => value.id === operation.paneId);
    if (owner?.floating && [operation.x, operation.y, operation.width, operation.height].every(Number.isFinite)) {
      Object.assign(owner, { x: Math.max(0, Math.min(4096, operation.x)), y: Math.max(0, Math.min(4096, operation.y)), width: Math.max(280, Math.min(1600, operation.width)), height: Math.max(200, Math.min(1600, operation.height)) });
    }
  } else {
    const owner = find(operation.tabId);
    if (!owner) return previous;
    if (operation.kind === 'focus') { owner.active = operation.tabId; layout.activePane = owner.id; }
    else if (operation.kind === 'close') {
      remove(operation.tabId); layout.tabs = layout.tabs.filter(value => value.id !== operation.tabId);
    } else if (operation.kind === 'move') {
      const destination = layout.panes.find(value => value.id === operation.paneId);
      if (!destination || operation.before === operation.tabId) return previous;
      remove(operation.tabId);
      const index = destination.tabs.indexOf(operation.before ?? '');
      destination.tabs.splice(index < 0 ? destination.tabs.length : index, 0, operation.tabId);
      destination.active = operation.tabId; layout.activePane = destination.id;
    } else if (operation.kind === 'dock') {
      remove(operation.tabId); layout.panes[0].tabs.push(operation.tabId); layout.panes[0].active = operation.tabId; layout.activePane = layout.panes[0].id;
    } else {
      if (operation.kind === 'split' && !owner.floating && owner.tabs.length < 2) return previous;
      let serial = 1; while (layout.panes.some(value => value.id === `pane-${serial}`)) serial++;
      const destination = pane(`pane-${serial}`, [operation.tabId]); destination.floating = operation.kind === 'float';
      remove(operation.tabId); layout.panes.push(destination); layout.activePane = destination.id;
    }
  }
  return tidy(layout);
}

/** Treat persisted data as untrusted, bounded preferences. */
export function restoreSidebarLayout(value: unknown): SidebarLayout {
  try {
    const input = value as SidebarLayout;
    if (!Array.isArray(input?.tabs) || !Array.isArray(input.panes)) return defaultSidebarLayout();
    const tabs: SidebarTab[] = [], seen = new Set<string>();
    for (const tab of input.tabs.slice(0, 64)) {
      const target = tab?.target;
      if (!target || !['git', 'context', 'plugin'].includes(target.kind)) continue;
      if (target.kind === 'plugin' && (![target.installationId, target.contributionId].every(id => typeof id === 'string' && id.length > 0 && id.length <= 512))) continue;
      const id = sidebarTabId(target);
      if (!seen.has(id)) { seen.add(id); tabs.push({ id, target }); }
    }
    const layout: SidebarLayout = { tabs, panes: [pane('main')], activePane: 'main' };
    const assigned = new Set<string>(), paneIds = new Set<string>();
    for (const source of input.panes.slice(0, 64)) {
      if (!source || typeof source.id !== 'string' || !Array.isArray(source.tabs)) continue;
      if (paneIds.has(source.id)) continue;
      paneIds.add(source.id);
      if (source.id !== 'main' && (!/^pane-\d+$/.test(source.id) || layout.panes.some(value => value.id === source.id))) continue;
      const target = source.id === 'main' ? layout.panes[0] : pane(source.id);
      target.tabs = source.tabs.filter(id => seen.has(id) && !assigned.has(id) && !!assigned.add(id));
      target.active = target.tabs.includes(source.active ?? '') ? source.active : target.tabs[0] ?? null;
      target.floating = source.id !== 'main' && source.floating === true;
      for (const key of ['x', 'y', 'width', 'height'] as const) if (Number.isFinite(source[key])) target[key] = Math.max(key === 'width' ? 280 : key === 'height' ? 200 : 0, Math.min(1600, source[key]));
      if (source.id !== 'main') layout.panes.push(target);
    }
    for (const tab of tabs) if (!assigned.has(tab.id)) layout.panes[0].tabs.push(tab.id);
    layout.activePane = input.activePane;
    return tidy(layout);
  } catch { return defaultSidebarLayout(); }
}
