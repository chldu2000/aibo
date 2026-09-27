import type { UiAgentStatusMarkProps, UiFileChangeMarkProps, UiModelMatrixProps, UiSessionControlMarkProps } from '../ui-kit/contract';
import type { PresentationPackageManifest } from '../../../packages/plugin-protocol/src/presentation-package';
import { fileChangeStates } from '../ui-kit/file-change.ts';
import { sessionControlAppearance } from '../ui-kit/session-control-appearance.ts';
import type { PresentationControlData } from '../../../packages/plugin-protocol/src/presentation-controls';
import type { PresentationContext, PresentationInput, PresentationIntent } from '../../../packages/plugin-protocol/src/presentation-runtime';

export type ModelSelection =
  | { token: string; kind: 'model'; model: string; reasoningEffort: string | null }
  | { token: string; kind: 'serviceTier'; serviceTier: string };

export function modelSelections(props: UiModelMatrixProps): ModelSelection[] {
  if (props.disabled) return [];
  const entries: ModelSelection[] = [];
  if (props.fastTier) entries.push({ token: `model:${entries.length}`, kind: 'serviceTier', serviceTier: props.fastTier.active ? 'default' : props.fastTier.id });
  for (const row of props.rows) {
    entries.push({ token: `model:${entries.length}`, kind: 'model', model: row.reference, reasoningEffort: null });
    for (const cell of row.cells) if (cell.available) entries.push({ token: `model:${entries.length}`, kind: 'model', model: row.reference, reasoningEffort: cell.id });
  }
  return entries;
}

type ControlData<Name extends PresentationControlData['control']> = Extract<PresentationControlData, { control: Name }>;

/**
 * One public control: how host props project to pure data, how a trusted user event
 * maps back to a host callback, and a preflight sample. Callbacks never leave the host.
 */
type HostApi = PresentationPackageManifest['hostApi'];
const hostApis: readonly HostApi[] = ['1.0.0', '1.1.0'];

type ControlDefinition<Name extends PresentationControlData['control'], Props> = {
  /** First host API that sends this control; older packages keep inheriting the kit rendering. */
  since: HostApi;
  project(props: Props): Omit<ControlData<Name>, 'control'>;
  /** Re-resolve against current props; stale or disabled tokens resolve to nothing. */
  resolve(props: Props, intent: Pick<PresentationIntent, 'id' | 'event'>): (() => void | Promise<void>) | null;
  preflight: Props;
  /** Decorative controls never take pointer input; a null label hides them from assistive technology. */
  decorative?: { label(props: Props): string | null };
};

export type ControlProps = {
  ModelMatrix: UiModelMatrixProps;
  AgentStatusMark: UiAgentStatusMarkProps;
  FileChangeMark: UiFileChangeMarkProps;
  SessionControlMark: UiSessionControlMarkProps;
};
export type PresentationControl = keyof ControlProps;

const registry: { [Name in PresentationControl]: ControlDefinition<Name, ControlProps[Name]> } = {
  ModelMatrix: {
    since: '1.0.0',
    project(props) {
      const { onSelect: _select, onSelectServiceTier: _tier, ...data } = props;
      return { props: data, actions: modelSelections(props) };
    },
    resolve(props, intent) {
      if (intent.event !== 'click') return null;
      const action = modelSelections(props).find(action => action.token === intent.id);
      if (!action) return null;
      return action.kind === 'serviceTier'
        ? () => props.onSelectServiceTier(action.serviceTier)
        : () => props.onSelect(action.model, action.reasoningEffort);
    },
    preflight: { columns: [{ id: 'medium', label: 'Medium', description: null }],
      rows: [{ reference: 'model', label: 'Model', isDefault: true, active: true, defaultActive: true,
        cells: [{ id: 'medium', label: 'Medium', description: null, available: true, active: false }] }],
      defaultLabel: 'Default', defaultTitle: 'Default reasoning', fastTier: null, disabled: false, onSelect() {}, onSelectServiceTier() {} },
  },
  AgentStatusMark: {
    since: '1.0.0',
    project: props => ({ props, actions: [] }),
    resolve: () => null,
    preflight: { agent: 'plugin', tone: 'idle', label: 'Plugin' },
    decorative: { label: props => props.label },
  },
  FileChangeMark: {
    since: '1.1.0',
    project: ({ kind, decorative = false }) => ({ props: { kind, label: fileChangeStates[kind].label, decorative }, actions: [] }),
    resolve: () => null,
    preflight: { kind: 'modified' },
    decorative: { label: ({ kind, decorative }) => decorative ? null : fileChangeStates[kind].label },
  },
  SessionControlMark: {
    since: '1.1.0',
    // Only the fields the mark classifies; labels and descriptions stay beside it in the host.
    project: ({ control, compact = false }) => ({
      props: { kind: control.kind, profile: { ...control.profile }, compact, appearance: sessionControlAppearance(control) },
      actions: [],
    }),
    resolve: () => null,
    preflight: { control: { kind: 'mode', profile: { interactionMode: 'plan' } } },
    decorative: { label: () => null },
  },
};

const definition = <Name extends PresentationControl>(control: Name) => registry[control] as ControlDefinition<Name, ControlProps[Name]>;

export const presentationControls = Object.keys(registry) as PresentationControl[];

/** Whether a package declaring `hostApi` receives this control; unknown versions receive nothing. */
export function controlAvailable(control: PresentationControl, hostApi: string) {
  const declared = hostApis.indexOf(hostApi as HostApi);
  return declared >= 0 && hostApis.indexOf(registry[control].since) <= declared;
}

export function controlInput<Name extends PresentationControl>(control: Name, props: ControlProps[Name],
  context: PresentationContext, theme: Readonly<Record<string, string>> = {}): PresentationInput {
  const data = { control, ...definition(control).project(props) };
  return { surface: 'controls', context, data: JSON.parse(JSON.stringify(data)), theme };
}

export function resolveControlIntent<Name extends PresentationControl>(control: Name, props: ControlProps[Name], intent: Pick<PresentationIntent, 'id' | 'event'>) {
  return definition(control).resolve(props, intent);
}

export const isDecorativeControl = (control: PresentationControl) => Boolean(registry[control].decorative);

/** Accessible name for decorative controls; null for interactive ones. */
export function decorativeLabel<Name extends PresentationControl>(control: Name, props: ControlProps[Name]) {
  return definition(control).decorative?.label(props) ?? null;
}

export function controlPreflights(hostApi: string = '1.0.0'): PresentationInput[] {
  const context = { workspaceId: 'preflight', sessionId: 'preflight', revision: 1 };
  return presentationControls.filter(control => controlAvailable(control, hostApi))
    .map(control => controlInput(control, definition(control).preflight, context));
}
