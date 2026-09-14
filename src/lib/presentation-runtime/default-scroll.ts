import type { PresentationContext } from '../../../packages/plugin-protocol/src/presentation-runtime';
import type { createPresentationViewStateStore } from './view-state';

/** Map message identity between layouts; their scroll containers have different contents. */
export function bindDefaultPresentationScroll(
  root: HTMLElement,
  store: ReturnType<typeof createPresentationViewStateStore>,
  context: () => PresentationContext,
  enabled: () => boolean,
) {
  const selector = '[data-presentation-timeline]';
  function capture(event: Event) {
    if (!enabled() || !(event.target instanceof HTMLElement) || !event.target.matches(selector)) return;
    const viewport = event.target.getBoundingClientRect();
    if (!viewport.height) return;
    const message = [...event.target.querySelectorAll<HTMLElement>('[data-presentation-message]')]
      .find(element => { const rect = element.getBoundingClientRect(); return rect.height > 0 && rect.bottom > viewport.top && rect.top < viewport.bottom; });
    if (!message) return;
    const scope = context();
    const state = store.read(scope) ?? { focus: null, scroll: [], window: [0, 0], disclosures: [] };
    store.write(scope, { ...state, timeline: { key: message.dataset.presentationMessage!, offset: message.getBoundingClientRect().top - viewport.top, source: 'default' } });
  }
  root.addEventListener('scroll', capture, true);
  return {
    restore() {
      if (!enabled()) return;
      const anchor = store.read(context())?.timeline;
      const viewport = root.querySelector<HTMLElement>(selector);
      if (!anchor || !viewport || !viewport.getClientRects().length) return;
      const message = [...viewport.querySelectorAll<HTMLElement>('[data-presentation-message]')].find(element => element.dataset.presentationMessage === anchor.key);
      if (!message) return;
      const rect = message.getBoundingClientRect();
      const offset = Math.max(-Math.max(0, rect.height - 24), anchor.offset);
      viewport.scrollTop += rect.top - viewport.getBoundingClientRect().top - offset;
    },
    dispose() { root.removeEventListener('scroll', capture, true); },
  };
}
