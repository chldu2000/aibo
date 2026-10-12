export type FrontendDiagnostic = { kind: 'exception' | 'unhandled_rejection' | 'presentation_failed'; resource?: string; line?: number; column?: number };
/** Messages, error objects, stack strings and rejection reasons never cross IPC. */
export function installFrontendDiagnostics(target: Window, send: (report: FrontendDiagnostic) => Promise<unknown>): () => void {
  const report = (diagnostic: FrontendDiagnostic) => {
    try { void send(diagnostic).catch(() => {}); } catch { /* Reporting failures must not report themselves. */ }
  };
  const exception = (event: ErrorEvent) => {
    const diagnostic: FrontendDiagnostic = { kind: 'exception' };
    try {
      const url = new URL(event.filename, target.location.href);
      if (url.origin === target.location.origin && /^\/(?:assets\/[^/]+\.js|src\/(?:main\.ts|App\.svelte))$/.test(url.pathname)) {
        diagnostic.resource = url.pathname.slice(1);
        if (Number.isInteger(event.lineno) && event.lineno >= 0 && event.lineno <= 1_000_000) diagnostic.line = event.lineno;
        if (Number.isInteger(event.colno) && event.colno >= 0 && event.colno <= 1_000_000) diagnostic.column = event.colno;
      }
    } catch { /* Unknown locations are omitted. */ }
    report(diagnostic);
  };
  const rejection = () => report({ kind: 'unhandled_rejection' });
  target.addEventListener('error', exception);
  target.addEventListener('unhandledrejection', rejection);
  return () => { target.removeEventListener('error', exception); target.removeEventListener('unhandledrejection', rejection); };
}
