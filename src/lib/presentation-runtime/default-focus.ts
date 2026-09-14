import type { PresentationContext } from '../../../packages/plugin-protocol/src/presentation-runtime';
import type { createPresentationViewStateStore } from './view-state';

/** Share semantic editor focus across implementations without copying editor contents. */
export function bindDefaultPresentationFocus(
  root: HTMLElement,
  store: ReturnType<typeof createPresentationViewStateStore>,
  context: () => PresentationContext,
  enabled: () => boolean,
) {
  const document = root.ownerDocument;
  const selector = 'textarea[data-presentation-focus="composer"]';
  function capture() {
    const element = document.activeElement;
    if (!enabled() || !(element instanceof HTMLTextAreaElement) || !root.contains(element) || !element.matches(selector)) return;
    const scope = context();
    const state = store.read(scope) ?? { focus: null, scroll: [], window: [0, 0], disclosures: [] };
    store.write(scope, { ...state, focus: { key: 'conversation:draft:input', selection: [element.selectionStart, element.selectionEnd] } });
  }
  for (const event of ['focusin', 'selectionchange', 'select', 'input']) document.addEventListener(event, capture, true);
  return {
    restore() {
      if (!enabled()) return;
      const focus = store.read(context())?.focus;
      if (focus?.key !== 'conversation:draft:input') return;
      const active = document.activeElement;
      if (active && active !== document.body && active.isConnected && !root.contains(active)) return;
      const element = root.querySelector<HTMLTextAreaElement>(selector);
      if (!element || element.disabled || element.closest('[hidden],[inert]') || !element.getClientRects().length) return;
      element.focus({ preventScroll: true });
      if (focus.selection) element.setSelectionRange(...focus.selection);
    },
    dispose() { for (const event of ['focusin', 'selectionchange', 'select', 'input']) document.removeEventListener(event, capture, true); },
  };
}
