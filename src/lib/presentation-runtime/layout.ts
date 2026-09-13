import type { PresentationLayout, PresentationLayoutAction } from '../../../packages/plugin-protocol/src/presentation-layout';
import type { PresentationContext, PresentationIntent } from '../../../packages/plugin-protocol/src/presentation-runtime';
import { createActionDirectory } from './action-directory.ts';
type Spec = Omit<PresentationLayoutAction, 'token'>;
const specs = (state: PresentationLayout): Spec[] => (['navigation', ...(state.auxiliaryOpen ? ['auxiliary'] as const : [])] as const).map(target => ({ operation: 'resize', event: 'input', args: [target] }));
export function createLayoutDirectory() {
  const directory = createActionDirectory<Spec>('layout');
  return {
    project: (state: PresentationLayout) => directory.project(specs(state), 'layout'),
    resolve(state: PresentationLayout, context: PresentationContext, intent: PresentationIntent) {
      const action = directory.resolve(specs(state), 'layout', context, intent);
      if (!action || !intent.value?.trim()) return null;
      const width = Number(intent.value), target = action.args[0], bounds = state[target];
      if (!Number.isFinite(width)) return null;
      return { target, width: Math.max(bounds.min, Math.min(bounds.max, width)) };
    },
  };
}
