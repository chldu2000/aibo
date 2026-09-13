import type { Snapshot } from './semantic.js';
export type PresentationCapabilityContribution = { scope?: 'application' | 'workspace' | 'session'; extensionPoint?: string; visibility?: 'always' | 'workspaceSelected' | 'sessionSelected'; installationId: string; contributionId: string; title: string; available: boolean; issue: string | null };
export type PresentationCapabilityScope = { kind:'application' } | {kind:'workspace'|'session';id:string};
export type PresentationCapabilityView = {
  snapshot: Snapshot | null;
  error: string;
  enhanced: boolean;
  layout: 'central' | 'sidebar';
  focusTarget: string | null;
  restoring: boolean;
};
export type PresentationCapabilityWorkbench = {
  catalog: PresentationCapabilityContribution[];
  selected: PresentationCapabilityContribution | null;
  scope: PresentationCapabilityScope;
  view: PresentationCapabilityView;
};
export type PresentationCapabilityAction = {
  token:string;
  operation:'open'|'close'|'reload'|'toggleLayout'|'toggleReading'|'semantic';
  event:'click';
  args:readonly (string|null)[];
};
