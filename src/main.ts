import { mount, tick } from 'svelte';
import './app.css';
import { isTauri, reportFrontendDiagnostic, diagnosticFrontendFailed } from './lib/api';
import { installFrontendDiagnostics } from './lib/frontend-diagnostics';

installFrontendDiagnostics(window, report => isTauri() ? reportFrontendDiagnostic(report) : Promise.resolve(false));

const app = import('./App.svelte').then(({ default: App }) => {
  const app = mount(App, { target: document.getElementById('app')! });
  void tick().then(() => document.getElementById('boot-status')?.remove());
  return app;
}).catch(error => {
  if (isTauri()) void diagnosticFrontendFailed().catch(() => {});
  throw error;
});

export default app;
