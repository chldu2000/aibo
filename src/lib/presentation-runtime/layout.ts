import type { PresentationLayout, PresentationLayoutAction } from '../../../packages/plugin-protocol/src/presentation-layout';
import type { PresentationContext, PresentationIntent } from '../../../packages/plugin-protocol/src/presentation-runtime';
import { createActionDirectory } from './action-directory.ts';
type Spec = Omit<PresentationLayoutAction, 'token'>;
const specs = (state: PresentationLayout): Spec[] => {
  if (state.switching) return [];
  const entries: Spec[] = (['standard', 'focus', 'review'] as const).map(mode => ({ operation: 'selectMode', event: 'click', args: [mode] }));
  if (state.mode !== 'focus') for (const target of ['navigation', 'auxiliary'] as const) {
    if (target === 'auxiliary' && !state.auxiliaryOpen) continue;
    entries.push({ operation: 'resize', event: 'input', args: [target, state.mode ?? 'standard'] });
  }
  return entries;
};
export function createLayoutDirectory() {
  const directory = createActionDirectory<Spec>('layout');
  return {
    project: (state: PresentationLayout) => directory.project(specs(state), 'layout'),
    resolve(state: PresentationLayout, context: PresentationContext, intent: PresentationIntent) {
      const action = directory.resolve(specs(state), 'layout', context, intent);
      if (!action) return null;
      if (action.operation === 'selectMode') return { kind: 'mode' as const, mode: action.args[0] };
      if (!intent.value?.trim()) return null;
      const width = Number(intent.value), target = action.args[0];
      if (target !== 'navigation' && target !== 'auxiliary') return null;
      const bounds = state[target];
      if (!Number.isFinite(width)) return null;
      return { kind: 'resize' as const, target, width: Math.max(bounds.min, Math.min(bounds.max, width)) };
    },
  };
}
