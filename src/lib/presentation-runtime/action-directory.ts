import type { PresentationContext, PresentationIntent } from '../../../packages/plugin-protocol/src/presentation-runtime';

export type PresentationActionSpec = { operation: string; event: 'click' | 'input' | 'change'; args: readonly (string | null)[] };
/** Only current entries survive. Reappearing operations and reentered scopes receive fresh tokens. */
export function createActionDirectory<Spec extends PresentationActionSpec>(prefix: string) {
  let serial = 0, owner = '';
  let current = new Map<string, Spec & { token: string }>();
  const identity = (spec: Spec) => JSON.stringify([spec.operation, spec.event, spec.args]);
  return {
    project(specs: readonly Spec[], scope: string): (Spec & { token: string })[] {
      if (owner !== scope) { current.clear(); owner = scope; }
      const next = new Map<string, Spec & { token: string }>();
      for (const spec of specs) {
        const key = identity(spec);
        if (!next.has(key)) next.set(key, current.get(key) ?? { ...spec, token: `${prefix}:${++serial}` });
      }
      current = next;
      return [...next.values()];
    },
    resolve(specs: readonly Spec[], scope: string, context: PresentationContext, intent: PresentationIntent): (Spec & { token: string }) | null {
      if (owner !== scope || intent.context.workspaceId !== context.workspaceId || intent.context.sessionId !== context.sessionId) return null;
      if (!Number.isSafeInteger(intent.context.revision) || intent.context.revision < 0 || intent.context.revision > context.revision) return null;
      const action = [...current.values()].find(action => action.token === intent.id && action.event === intent.event);
      if (!action || !specs.some(spec => identity(spec) === identity(action))) return null;
      if (action.event !== 'input' && intent.context.revision !== context.revision) return null;
      if (action.event !== 'click' && (typeof intent.value !== 'string' || intent.value.length > 1024 * 1024)) return null;
      return action;
    },
  };
}
