import type { UiAgentStatusMarkProps, UiModelMatrixProps } from '../ui-kit/contract';
import type { PresentationContext, PresentationInput } from '../../../packages/plugin-protocol/src/presentation-runtime';

export type PresentationControl = 'ModelMatrix' | 'AgentStatusMark';
export type ModelSelection = { token: string; model: string; reasoningEffort: string | null };

export function modelSelections(props: UiModelMatrixProps): ModelSelection[] {
  if (props.disabled) return [];
  const entries: ModelSelection[] = [];
  for (const row of props.rows) {
    entries.push({ token: `model:${entries.length}`, model: row.reference, reasoningEffort: null });
    for (const cell of row.cells) if (cell.available) entries.push({ token: `model:${entries.length}`, model: row.reference, reasoningEffort: cell.id });
  }
  return entries;
}

export function controlInput(control: PresentationControl, props: UiModelMatrixProps | UiAgentStatusMarkProps,
  context: PresentationContext, theme: Readonly<Record<string, string>> = {}): PresentationInput {
  const data = control === 'ModelMatrix'
    ? (() => { const { onSelect: _callback, ...data } = props as UiModelMatrixProps; return { control, props: data, actions: modelSelections(props as UiModelMatrixProps) }; })()
    : { control, props, actions: [] };
  return { surface: 'controls', context, data: JSON.parse(JSON.stringify(data)), theme };
}

export function controlPreflights(): PresentationInput[] {
  const context = { workspaceId: 'preflight', sessionId: 'preflight', revision: 1 };
  return [
    controlInput('ModelMatrix', { columns: [{ id: 'medium', label: 'Medium', description: null }],
      rows: [{ reference: 'model', label: 'Model', isDefault: true, active: true, defaultActive: true,
        cells: [{ id: 'medium', label: 'Medium', description: null, available: true, active: false }] }],
      defaultLabel: 'Default', defaultTitle: 'Default reasoning', disabled: false, onSelect() {} }, context),
    controlInput('AgentStatusMark', { agent: 'plugin', tone: 'idle', label: 'Plugin' }, context),
  ];
}
