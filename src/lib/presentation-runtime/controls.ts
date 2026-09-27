import type { UiAgentStatusMarkProps, UiFileChangeMarkProps, UiModelContextSelectProps, UiModelMatrixProps, UiSelectProps, UiSessionControlMarkProps } from '../ui-kit/contract';
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

type Run = () => void | Promise<void>;
/** Options for a listbox the host draws outside the isolated frame; the choice never passes through the package. */
export type HostMenu = { label: string; options: { value: string; label: string; disabled: boolean }[]; value: string };
export type ControlEffect<Props> =
  | { kind: 'run'; run: Run }
  | { kind: 'menu'; menu(props: Props): HostMenu | null; choose(props: Props, value: string): Run | null };

type ControlDefinition<Name extends PresentationControlData['control'], Props> = {
  /** First host API that sends this control; older packages keep inheriting the kit rendering. */
  since: HostApi;
  project(props: Props): Omit<ControlData<Name>, 'control'>;
  /** Re-resolve against current props; stale or disabled tokens resolve to nothing. */
  resolve(props: Props, intent: Pick<PresentationIntent, 'id' | 'event'>): ControlEffect<Props> | null;
  preflight: Props;
  /** Frame size: a fixed panel, a 20px mark, or the measured size of the default control. */
  frame: 'panel' | 'mark' | 'footprint';
  /** Decorative controls never take pointer input; a null label hides them from assistive technology. */
  decorative?: { label(props: Props): string | null };
};

/** A menu control opens only when enabled with at least one enabled option. */
function menuControl<Props>(menu: (props: Props) => HostMenu | null, select: (props: Props, value: string) => Run): Pick<ControlDefinition<never, Props>, 'resolve'> & { actions(props: Props): { token: 'open'; kind: 'open' }[] } {
  const effect: ControlEffect<Props> = {
    kind: 'menu', menu,
    choose(props, value) {
      const current = menu(props);
      const option = current?.options.find(option => option.value === value);
      return current && option && !option.disabled && value !== current.value ? select(props, value) : null;
    },
  };
  return {
    actions: props => menu(props) ? [{ token: 'open', kind: 'open' }] : [],
    resolve: (props, intent) => intent.event === 'click' && intent.id === 'open' && menu(props) ? effect : null,
  };
}

const selectMenu = (props: UiSelectProps): HostMenu | null =>
  props.disabled || !props.options.some(option => !option.disabled) ? null : {
    label: props['aria-label'] ?? props.title ?? props.placeholder ?? '请选择',
    options: props.options.map(({ value, label, disabled }) => ({ value, label, disabled: Boolean(disabled) })),
    value: props.value,
  };
const select = menuControl(selectMenu, (props: UiSelectProps, value) => () => props.onSelect(value));

const contextMenu = (props: UiModelContextSelectProps): HostMenu | null =>
  props.disabled || props.options.length === 0 ? null : {
    label: '模型上下文大小',
    options: props.options.map(option => ({ value: option.id, label: option.label, disabled: false })),
    value: props.options.some(option => option.id === props.current) ? props.current ?? '' : '',
  };
const contextSelect = menuControl(contextMenu, (props: UiModelContextSelectProps, value) => () => { void props.onSelect(value); });

export type ControlProps = {
  ModelMatrix: UiModelMatrixProps;
  AgentStatusMark: UiAgentStatusMarkProps;
  FileChangeMark: UiFileChangeMarkProps;
  SessionControlMark: UiSessionControlMarkProps;
  Select: UiSelectProps;
  ModelContextSelect: UiModelContextSelectProps;
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
      return { kind: 'run', run: action.kind === 'serviceTier'
        ? () => props.onSelectServiceTier(action.serviceTier)
        : () => props.onSelect(action.model, action.reasoningEffort) };
    },
    preflight: { columns: [{ id: 'medium', label: 'Medium', description: null }],
      rows: [{ reference: 'model', label: 'Model', isDefault: true, active: true, defaultActive: true,
        cells: [{ id: 'medium', label: 'Medium', description: null, available: true, active: false }] }],
      defaultLabel: 'Default', defaultTitle: 'Default reasoning', fastTier: null, disabled: false, onSelect() {}, onSelectServiceTier() {} },
    frame: 'panel',
  },
  AgentStatusMark: {
    since: '1.0.0',
    project: props => ({ props, actions: [] }),
    resolve: () => null,
    preflight: { agent: 'plugin', tone: 'idle', label: 'Plugin' },
    frame: 'mark',
    decorative: { label: props => props.label },
  },
  FileChangeMark: {
    since: '1.1.0',
    project: ({ kind, decorative = false }) => ({ props: { kind, label: fileChangeStates[kind].label, decorative }, actions: [] }),
    resolve: () => null,
    preflight: { kind: 'modified' },
    frame: 'mark',
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
    frame: 'mark',
    decorative: { label: () => null },
  },
  Select: {
    since: '1.1.0',
    project: props => ({
      props: {
        options: props.options.map(({ value, label, disabled }) => ({ value, label, disabled: Boolean(disabled) })),
        value: props.value, placeholder: props.placeholder ?? '请选择', disabled: Boolean(props.disabled),
        label: props['aria-label'] ?? props.title ?? props.placeholder ?? '请选择',
      },
      actions: select.actions(props),
    }),
    resolve: select.resolve,
    preflight: { options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], value: 'a', 'aria-label': 'Preflight', onSelect() {} },
    frame: 'footprint',
  },
  ModelContextSelect: {
    since: '1.1.0',
    project: props => ({
      props: {
        options: props.options.map(({ id, label, description, tokens }) => ({ id, label, description, tokens: tokens ?? null })),
        current: props.current, disabled: Boolean(props.disabled),
      },
      actions: contextSelect.actions(props),
    }),
    resolve: contextSelect.resolve,
    preflight: { options: [{ id: 'standard', label: '272K', description: null, tokens: 272000 }], current: 'standard', disabled: false, onSelect() {} },
    frame: 'footprint',
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
export const controlFrame = (control: PresentationControl) => registry[control].frame;

/** Accessible name for decorative controls; null for interactive ones. */
export function decorativeLabel<Name extends PresentationControl>(control: Name, props: ControlProps[Name]) {
  return definition(control).decorative?.label(props) ?? null;
}

export function controlPreflights(hostApi: string = '1.0.0'): PresentationInput[] {
  const context = { workspaceId: 'preflight', sessionId: 'preflight', revision: 1 };
  return presentationControls.filter(control => controlAvailable(control, hostApi))
    .map(control => controlInput(control, definition(control).preflight, context));
}
