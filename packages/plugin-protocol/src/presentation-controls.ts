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
  disabled: boolean;
};
export type PresentationStatusMark = {
  agent: 'codex' | 'pi' | 'plugin';
  tone: 'idle' | 'running' | 'attention' | 'danger' | 'muted';
  label: string;
};
export type PresentationControlData =
  | { control: 'ModelMatrix'; props: PresentationModelMatrix; actions: readonly { token: string; model: string; reasoningEffort: string | null }[] }
  | { control: 'AgentStatusMark'; props: PresentationStatusMark; actions: readonly [] };
