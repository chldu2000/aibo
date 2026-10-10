/** Design tokens a sandboxed tool may use. Colours, radius and type only: no layout, no host state. */
export const TOOL_THEME_TOKENS = [
  '--aibo-bg', '--aibo-text', '--aibo-muted', '--aibo-subtle', '--aibo-border', '--aibo-border-strong',
  '--aibo-surface', '--aibo-surface-hover', '--aibo-accent', '--aibo-accent-border', '--aibo-accent-soft',
  '--aibo-accent-text', '--aibo-focus', '--aibo-danger-text', '--aibo-mono',
] as const;

function readToolTheme(frame: HTMLIFrameElement): Record<string, string> {
  const style = getComputedStyle(frame);
  const theme: Record<string, string> = {};
  for (const name of TOOL_THEME_TOKENS) { const value = style.getPropertyValue(name).trim(); if (value) theme[name] = value; }
  theme['--aibo-ui-kit'] = frame.closest('[data-ui-kit]')?.getAttribute('data-ui-kit') ?? '';
  return theme;
}

/** An opaque-origin frame receives only a per-mount MessagePort, never Tauri IPC. */
export function connectToolFrame(frame: HTMLIFrameElement, request: (payload: unknown) => Promise<unknown>, reload: () => void = () => {}): () => void {
  const channel = new MessageChannel(); let disposed = false, queued = 0;
  let tail = Promise.resolve();
  channel.port1.onmessage = event => {
    const message = event.data;
    // A view that has lost its backend asks the host to rebuild it; the host never shows a permanent reload row.
    if (!disposed && message?.type === 'reload') { reload(); return; }
    if (disposed || !message || typeof message.id !== 'number' || !Number.isSafeInteger(message.id)) return;
    let length: number;
    try { length = JSON.stringify(message).length; } catch { channel.port1.postMessage({id:message.id,error:'Tool request must be JSON'}); return; }
    if (queued >= 128 || length > 131072) {
      channel.port1.postMessage({id:message.id,error:'Tool request limit exceeded'}); return;
    }
    queued++;
    tail = tail.then(async () => {
      if (disposed) return;
      try { const result = await request(message.request); if (!disposed) channel.port1.postMessage({id:message.id,result}); }
      catch (error) { if (!disposed) channel.port1.postMessage({id:message.id,error:String(error)}); }
    }).finally(() => { queued--; });
  };
  frame.contentWindow?.postMessage({type:'aibo.tool-view.connect',protocol:'1',theme:readToolTheme(frame)}, '*', [channel.port2]);
  // Skin or colour-scheme switches re-send the tokens; the view must not cache them.
  const push = () => { if (!disposed) channel.port1.postMessage({type:'theme',theme:readToolTheme(frame)}); };
  const observer = typeof MutationObserver === 'undefined' ? null : new MutationObserver(push);
  const watched = [document.documentElement, frame.closest('[data-ui-kit]')].filter((node): node is Element => !!node);
  for (const node of watched) observer?.observe(node, {attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-ui-kit', 'data-color-scheme']});
  return () => { disposed = true; observer?.disconnect(); channel.port1.close(); };
}
