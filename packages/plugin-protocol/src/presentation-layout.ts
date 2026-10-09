export type PresentationLayout = {
  navigation: { width: number; min: number; max: number };
  auxiliary: { width: number; min: number; max: number };
  auxiliaryOpen: boolean;
  mode?: 'standard' | 'focus' | 'review';
  switching?: boolean;
};
export type PresentationLayoutAction = {
  token: string;
  operation: 'resize' | 'selectMode';
  event: 'input' | 'click';
  args: readonly ('navigation' | 'auxiliary' | 'standard' | 'focus' | 'review')[];
};

/** Serializable layout only; plugin leases and file data never enter storage. */
export type SidebarTarget = { kind: 'git' | 'context' } | { kind: 'plugin'; installationId: string; contributionId: string };
export type SidebarTab = { id: string; target: SidebarTarget };
export type SidebarPane = { id: string; tabs: string[]; active: string | null; floating: boolean; x: number; y: number; width: number; height: number };
export type SidebarLayout = { tabs: SidebarTab[]; panes: SidebarPane[]; activePane: string };
export type SidebarOperation =
  | { kind: 'open'; target: SidebarTarget; paneId?: string }
  | { kind: 'focus' | 'close'; tabId: string }
  | { kind: 'reorder'; tabId: string; before?: string }
  | { kind: 'move'; tabId: string; paneId: string; before?: string }
  | { kind: 'split' | 'float' | 'dock'; tabId: string }
  | { kind: 'bounds'; paneId: string; x: number; y: number; width: number; height: number };

export type PresentationSidebar = {
  layout: SidebarLayout;
  titles: Record<string, string>;
  entries: { label: string; value: string; disabled?: boolean }[];
  views: Record<string, import('./presentation-capability.js').PresentationCapabilityView>;
};
export type PresentationSidebarAction = {
  token: string; operation: 'layout' | 'reload' | 'reading' | 'semantic'; event: 'click'; args: readonly (string | null)[];
};
