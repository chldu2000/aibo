import { mount, unmount } from 'svelte';
import { writable } from 'svelte/store';
import Root from './SvelteRoot.svelte';
import { assertSnapshot } from '../presentation/validation.ts';
import type { WebPresentationAdapter } from './types';
export function createSveltePresentationAdapter(detailPresentation: 'plain' | 'numbered' = 'plain'): WebPresentationAdapter { return {
  async mount(target, props) {
    const validate = (value: typeof props.snapshot) => {
      assertSnapshot(value);
      if (detailPresentation === 'numbered' && value.view.kind === 'detail' && value.view.content.split('\n').length > 5000) throw Error('specialized_presentation_limit: numbered view exceeds 5000 lines');
    };
    validate(props.snapshot);
    const snapshot = writable(props.snapshot);
    const focusTarget = writable(props.focusTarget ?? null);
    const instance = mount(Root, { target, props: { ...props, detailPresentation, snapshot, focusTarget } });
    let disposed = false;
    return { update(next, focus) { if (!disposed) { validate(next); snapshot.set(next); if (focus !== undefined) focusTarget.set(focus); } }, async dispose() { disposed = true; await unmount(instance); } };
  },
}; }
export const SveltePresentationAdapter = createSveltePresentationAdapter();
