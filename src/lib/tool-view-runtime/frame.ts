/** An opaque-origin frame receives only a per-mount MessagePort, never Tauri IPC. */
export function connectToolFrame(frame: HTMLIFrameElement, request: (payload: unknown) => Promise<unknown>): () => void {
  const channel = new MessageChannel(); let disposed = false, queued = 0;
  let tail = Promise.resolve();
  channel.port1.onmessage = event => {
    const message = event.data;
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
  frame.contentWindow?.postMessage({type:'aibo.tool-view.connect',protocol:'1'}, '*', [channel.port2]);
  return () => { disposed = true; channel.port1.close(); };
}
