import type { UiAgentStatusMarkProps, UiModelMatrixProps } from '../ui-kit/contract';
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
type ControlDefinition<Name extends PresentationControlData['control'], Props> = {
  project(props: Props): Omit<ControlData<Name>, 'control'>;
  /** Re-resolve against current props; stale or disabled tokens resolve to nothing. */
  resolve(props: Props, intent: Pick<PresentationIntent, 'id' | 'event'>): (() => void | Promise<void>) | null;
  preflight: Props;
  /** Decorative controls are images named by the host label and never take pointer input. */
  decorative?: { label(props: Props): string };
};

export type ControlProps = {
  ModelMatrix: UiModelMatrixProps;
  AgentStatusMark: UiAgentStatusMarkProps;
};
export type PresentationControl = keyof ControlProps;

const registry: { [Name in PresentationControl]: ControlDefinition<Name, ControlProps[Name]> } = {
  ModelMatrix: {
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
    project: props => ({ props, actions: [] }),
    resolve: () => null,
    preflight: { agent: 'plugin', tone: 'idle', label: 'Plugin' },
    decorative: { label: props => props.label },
  },
};

const definition = <Name extends PresentationControl>(control: Name) => registry[control] as ControlDefinition<Name, ControlProps[Name]>;

export const presentationControls = Object.keys(registry) as PresentationControl[];

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

export function controlPreflights(): PresentationInput[] {
  const context = { workspaceId: 'preflight', sessionId: 'preflight', revision: 1 };
  return presentationControls.map(control => controlInput(control, definition(control).preflight, context));
}
