import type { AgentIcon } from './agent-icon.js';
/** Data-only control customization contract; callbacks remain in the host UI kit. */
export type PresentationModelCell = {
  id: string;
  label: string;
  description: string | null;
  available: boolean;
  active: boolean;
};
export type PresentationModelColumn = Pick<PresentationModelCell, 'id' | 'label' | 'description'>;
export type PresentationModelRow = {
  reference: string;
  label: string;
  isDefault: boolean;
  active: boolean;
  defaultActive: boolean;
  cells: readonly PresentationModelCell[];
};
export type PresentationModelMatrix = {
  columns: readonly PresentationModelColumn[];
  rows: readonly PresentationModelRow[];
  defaultLabel: string;
  defaultTitle: string;
  fastTier: { id: string; label: string; description: string | null; active: boolean } | null;
  disabled: boolean;
};
export type PresentationStatusMark = {
  agent: 'codex' | 'pi' | 'plugin';
  icon?: AgentIcon;
  tone: 'idle' | 'running' | 'attention' | 'danger' | 'muted';
  label: string;
};
export type PresentationControlData =
  | { control: 'ModelMatrix'; props: PresentationModelMatrix; actions: readonly ({ token: string; kind: 'model'; model: string; reasoningEffort: string | null } | { token: string; kind: 'serviceTier'; serviceTier: string })[] }
  | { control: 'AgentStatusMark'; props: PresentationStatusMark; actions: readonly [] };
