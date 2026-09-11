import { mount, unmount } from 'svelte';
import { writable } from 'svelte/store';
import Root from './SvelteRoot.svelte';
import { assertSnapshot } from '../presentation/validation.ts';
import type { WebPresentationAdapter } from './types';
export const SveltePresentationAdapter: WebPresentationAdapter = {
  async mount(target, props) {
    assertSnapshot(props.snapshot);
    const snapshot = writable(props.snapshot);
    const focusTarget = writable(props.focusTarget ?? null);
    const instance = mount(Root, { target, props: { ...props, snapshot, focusTarget } });
    let disposed = false;
    return { update(next, focus) { if (!disposed) { assertSnapshot(next); snapshot.set(next); if (focus !== undefined) focusTarget.set(focus); } }, async dispose() { disposed = true; await unmount(instance); } };
  },
};
