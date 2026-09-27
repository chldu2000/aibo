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
/** Host API 1.1.0. The host supplies the label; decorative marks are hidden from assistive technology. */
export type PresentationFileChangeMark = {
  kind: 'added' | 'modified' | 'deleted' | 'renamed' | 'conflicted';
  label: string;
  decorative: boolean;
};
/** Host API 1.1.0. `appearance` is the host's classification of the declared policy; always decorative. */
export type PresentationSessionControlMark = {
  kind: 'permission' | 'mode';
  profile: Readonly<Record<string, string | undefined>>;
  compact: boolean;
  appearance: { icon: string; tone: 'info' | 'plan' | 'write' | 'elevated' | 'neutral' };
};
/** Host API 1.1.0. The package draws the closed trigger; `open` asks the host to draw the listbox outside the frame. */
export type PresentationSelect = {
  options: readonly { value: string; label: string; disabled: boolean }[];
  value: string;
  placeholder: string;
  disabled: boolean;
  label: string;
};
/** Host API 1.1.0. Same trigger-only customization as Select. */
export type PresentationModelContextSelect = {
  options: readonly { id: string; label: string; description: string | null; tokens: number | null }[];
  current: string | null;
  disabled: boolean;
};
export type PresentationOpenAction = { token: 'open'; kind: 'open' };
export type PresentationControlData =
  | { control: 'ModelMatrix'; props: PresentationModelMatrix; actions: readonly ({ token: string; kind: 'model'; model: string; reasoningEffort: string | null } | { token: string; kind: 'serviceTier'; serviceTier: string })[] }
  | { control: 'AgentStatusMark'; props: PresentationStatusMark; actions: readonly [] }
  | { control: 'FileChangeMark'; props: PresentationFileChangeMark; actions: readonly [] }
  | { control: 'SessionControlMark'; props: PresentationSessionControlMark; actions: readonly [] }
  | { control: 'Select'; props: PresentationSelect; actions: readonly PresentationOpenAction[] }
  | { control: 'ModelContextSelect'; props: PresentationModelContextSelect; actions: readonly PresentationOpenAction[] };
