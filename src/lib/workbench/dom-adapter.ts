import { actionMessage } from '../presentation/actions.ts';
import { assertSnapshot } from '../presentation/validation.ts';
import type { WebPresentationAdapter } from './types.ts';
/** Minimal independent renderer for contract verification, not a second product UI. */
export const DomPresentationAdapter: WebPresentationAdapter = {
  async mount(target, props) {
    let disposed = false;
    let current = props.snapshot;
    const render = () => {
      assertSnapshot(current);
      const doc = target.ownerDocument;
      const section = doc.createElement('section');
      section.setAttribute('aria-label', current.contribution.title);
      section.setAttribute('aria-busy', String(current.state.status === 'loading'));
      const heading = doc.createElement('h2'); heading.textContent = current.contribution.title; section.append(heading);
      const status = doc.createElement('p'); status.textContent = current.state.message; status.setAttribute('role', current.state.status === 'error' ? 'alert' : 'status'); section.append(status);
      const button = (actionId: (typeof current.actions)[number]['id'], label: string, itemId: string | null = null) => {
        const element = doc.createElement('button'); element.type = 'button'; element.textContent = label;
        element.disabled = current.state.status === 'loading' || !current.actions.some(action => action.id === actionId && action.enabled);
        element.addEventListener('click', () => { if (!disposed && !element.disabled) props.onAction(actionMessage(current, actionId, itemId)); });
        section.append(element);
      };
      for (const action of current.actions.filter(action => action.id !== 'open-diff')) button(action.id, action.label);
      if (current.view.kind === 'collection') {
        const page = doc.createElement('p'); page.textContent = `${current.view.page.total} 项；偏移 ${current.view.page.offset}${current.view.page.truncated ? '；部分结果' : ''}`; section.append(page);
        for (const item of current.view.items) {
          const text = current.view.properties.map(property => `${property.label}: ${item.values[property.key]}`).join(' · ');
          button('open-diff', `${current.actions.find(action => action.id === 'open-diff')?.label ?? '查看差异'} ${text}`, item.id);
        }
      } else {
        for (const property of current.view.properties) { const text = doc.createElement('p'); text.textContent = `${property.label}: ${property.value}`; section.append(text); }
        const pre = doc.createElement('textarea'); pre.readOnly = true; pre.rows = 16; pre.setAttribute('aria-label', '文件差异内容'); pre.value = current.view.content; section.append(pre);
        if (current.view.truncated) { const text = doc.createElement('p'); text.textContent = '差异内容已截断'; section.append(text); }
      }
      target.replaceChildren(section);
    };
    render();
    return { update(next) { if (!disposed) { current = next; render(); } }, async dispose() { disposed = true; target.replaceChildren(); } };
  },
};
