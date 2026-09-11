import type { ActionMessage, Snapshot } from '../presentation/contract';
import type { PresentationAction, PresentationSnapshot } from '../presentation/presentation-contract';
import { actionMessage } from '../presentation/actions';
import { withTimeout } from './async-timeout';

/** Trusted local lifecycle ports, separate from the JSON protocol and Agent runtime. */
export type MountedRenderer<View = Snapshot> = { update(snapshot: PresentationSnapshot<View>): void; dispose(): Promise<void> };
export type Renderer<View = Snapshot, Action = ActionMessage> = {
  preflight(snapshot: PresentationSnapshot<View>): Promise<void>;
  mount(snapshot: PresentationSnapshot<View>, dispatch: (message: PresentationAction<Action>) => boolean, active: () => boolean): Promise<MountedRenderer<View>>;
};

export function createPresentationController<View = Snapshot, Action = ActionMessage>(options: {
  view: View;
  recovery: PresentationSnapshot['recovery'];
  fallback: Renderer<View, Action>;
  onAction(action: Action): void;
  validateAction?: (view: View, action: Action) => boolean;
  onError(error: unknown): void;
  timeoutMs?: number;
}) {
  let view = structuredClone(options.view);
  let recovery = structuredClone(options.recovery);
  let generation = 0;
  let requested = 0;
  let disposed = false;
  let mounted: MountedRenderer<View> | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  const snapshot = (): PresentationSnapshot<View> => structuredClone({ schema: 'aibo.presentation/experimental-v1', generation, view, recovery });
  const bounded = <T>(promise: Promise<T>) => withTimeout(promise, options.timeoutMs ?? 5000, 'presentation_timeout');
  function dispatch(message: PresentationAction<Action>): boolean {
    if (!message || typeof message !== 'object') return false;
    if (disposed || !mounted || message.schema !== 'aibo.presentation-action/experimental-v1' || message.generation !== generation) return false;
    try {
      if (options.validateAction) {
        if (!options.validateAction(view, message.action)) return false;
      } else {
        const action = message.action as ActionMessage;
        const expected = actionMessage(view as Snapshot, action.actionId, action.itemId);
        if (JSON.stringify(expected) !== JSON.stringify(action)) return false;
      }
      options.onAction(structuredClone(message.action));
      return true;
    } catch { return false; }
  }
  async function detach() {
    ++generation;
    const previous = mounted;
    mounted = null;
    if (previous) await bounded(previous.dispose());
  }
  async function mount(renderer: Renderer<View, Action>, ticket: number) {
    let expired = false;
    const owner = generation;
    const active = () => !expired && !disposed && ticket === requested && owner === generation;
    const pending = renderer.mount(snapshot(), message => !expired && !disposed && owner === generation && dispatch(message), active);
    void pending.then(instance => {
      if (expired) void instance.dispose().catch(options.onError);
    }, () => {});
    let instance: MountedRenderer<View>;
    try { instance = await bounded(pending); }
    catch (error) { expired = true; throw error; }
    if (disposed || ticket !== requested) { await bounded(instance.dispose()); return; }
    try { instance.update(snapshot()); }
    catch (error) { await bounded(instance.dispose()); throw error; }
    mounted = instance;
  }
  const controller = {
    snapshot,
    update(next: View, nextRecovery: PresentationSnapshot['recovery']) {
      if (disposed) return;
      view = structuredClone(next); recovery = structuredClone(nextRecovery);
      try { mounted?.update(snapshot()); }
      catch (error) { options.onError(error); void controller.switchRenderer(options.fallback).catch(options.onError); }
    },
    switchRenderer(renderer: Renderer<View, Action>): Promise<void> {
      const ticket = ++requested;
      const operation = async () => {
        if (disposed || ticket !== requested) return;
        // Failed preflight leaves the working renderer and its channel intact.
        try { await bounded(renderer.preflight(snapshot())); }
        catch (error) {
          options.onError(error);
          if (!mounted && !disposed && ticket === requested && renderer !== options.fallback) {
            ++generation;
            await bounded(options.fallback.preflight(snapshot()));
            await mount(options.fallback, ticket);
          }
          return;
        }
        if (disposed || ticket !== requested) return;
        try { await detach(); await mount(renderer, ticket); }
        catch (error) {
          options.onError(error);
          if (disposed || ticket !== requested) return;
          ++generation;
          await bounded(options.fallback.preflight(snapshot()));
          await mount(options.fallback, ticket);
        }
      };
      const pending = queue.then(operation);
      queue = pending.catch(options.onError);
      return pending;
    },
    async dispose() {
      disposed = true; ++requested; ++generation;
      await queue;
      await detach();
    },
  };
  return controller;
}
