import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke as rawInvoke } from '@tauri-apps/api/core';
import { installFrontendDiagnostics } from '../src/lib/frontend-diagnostics.ts';
import { preparePresentationSandbox } from '../src/lib/presentation-runtime/sandbox.ts';
const diagnosticInvoke = (command, args) => rawInvoke(command, args, { headers: { 'Aibo-Diagnostic-Access': window.__AIBO_DIAGNOSTIC_ACCESS__ ?? '' } });
const captured = [];
installFrontendDiagnostics(window, diagnostic => diagnosticInvoke('report_frontend_diagnostic', { diagnostic }).then(accepted => { captured.push({ kind: diagnostic.kind, accepted }); return accepted; }));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = (condition, message) => { if (!condition) throw Error(message); };
const send = value => fetch('/__diagnostic_report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
try {
  if (getCurrentWindow().label !== 'main') {
    let denied = false;
    try { await diagnosticInvoke('report_frontend_diagnostic', { diagnostic: { kind: 'exception' } }); } catch { denied = true; }
    check(denied, 'Untrusted window must be denied');
    await send({ ok: true, stage: 'untrusted', denied });
  } else {
    let status;
    for (let attempt = 0; attempt < 100; attempt++) {
      status = await diagnosticInvoke('get_diagnostic_log_status');
      if (status.state === 'healthy') break;
      await delay(50);
    }
    check(status.state === 'healthy', 'Native writer must be available');
    let missingAccessDenied = false;
    try { await rawInvoke('report_frontend_diagnostic', { diagnostic: { kind: 'exception' } }); } catch { missingAccessDenied = true; }
    check(missingAccessDenied, 'Window label alone must not authorize diagnostic writes');
    const frame = document.createElement('iframe'); frame.setAttribute('sandbox', 'allow-scripts');
    const childResult = new Promise(resolve => {
      const receive = event => { if (event.source === frame.contentWindow && event.data?.probe === 'diagnostic-frame') { removeEventListener('message', receive); resolve(event.data); } };
      addEventListener('message', receive);
    });
    frame.srcdoc = `<script>(async()=>{let denied=true;const access=typeof window.__AIBO_DIAGNOSTIC_ACCESS__==='string';if(window.__TAURI_INTERNALS__?.invoke){try{await window.__TAURI_INTERNALS__.invoke('report_frontend_diagnostic',{diagnostic:{kind:'exception',resource:'src/main.ts',line:777,column:1}});denied=false}catch{}}parent.postMessage({probe:'diagnostic-frame',denied,access},'*')})()<\/script>`;
    document.body.append(frame); const child = await childResult; frame.remove();
    check(child.denied && !child.access, 'Opaque frame must have neither host access nor logging permission');
    await diagnosticInvoke('diagnostic_frontend_ready');
    const first = await diagnosticInvoke('report_frontend_diagnostic', { diagnostic: { kind: 'exception', resource: 'src/main.ts', line: 12, column: 8 } });
    const duplicate = await diagnosticInvoke('report_frontend_diagnostic', { diagnostic: { kind: 'exception', resource: 'src/main.ts', line: 12, column: 8 } });
    check(first === true && duplicate === false, 'Native fingerprint suppression');
    setTimeout(() => { throw Error('diagnostic-native-canary'); }, 0);
    Promise.reject({ password: 'diagnostic-native-canary' });
    for (let attempt = 0; attempt < 100 && !['exception', 'unhandled_rejection'].every(kind => captured.some(row => row.kind === kind && row.accepted)); attempt++) await delay(50);
    check(['exception', 'unhandled_rejection'].every(kind => captured.some(row => row.kind === kind && row.accepted)), 'Real uncaught exception and rejection must reach native IPC');
    const networkTarget = new URL('/__diagnostic_network_canary', location.href).href;
    const importTarget = new URL('/__diagnostic_import_canary.js', location.href).href;
    const source = `self.aiboPresentation={async render(input){if(input.context.revision>1)throw Error('native-presentation-secret-canary');let network=false,evaluation=false,imports=false;try{await fetch(${JSON.stringify(networkTarget)})}catch{network=true}try{new Function('return 1')()}catch{evaluation=true}try{importScripts(${JSON.stringify(importTarget)})}catch{imports=true}if(!network||!evaluation||!imports)throw Error('presentation-isolation-rejected');return {tag:'main',key:'diag',children:[{tag:'h1',key:'title',text:'Diagnostic Worker'}]};}};`;
    const bytes = new TextEncoder().encode(source);
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    const manifest = { schema: 'aibo.presentation-package/v1', id: 'dev.test.diagnostic-fault', version: '1.0.0', displayName: 'Diagnostic fault', hostApi: '1.0.0', coreSemantics: '1.0.0', snapshotSchemas: ['aibo.semantic-view/v1'], entry: 'fault.js', surfaces: ['workbench'], resources: [{ path: 'fault.js', bytes: bytes.length, sha256: hash, mediaType: 'text/javascript' }] };
    const installed = { release: { digest: hash, enabled: true, manifest }, resources: { 'fault.js': btoa(source) } };
    const target = document.createElement('div'); document.body.append(target);
    let finishFault;
    const fault = new Promise(resolve => { finishFault = resolve; });
    const input = { surface: 'workbench', context: { workspaceId: null, sessionId: null, revision: 1 }, data: null, theme: {}, locale: 'en' };
    const sandbox = await preparePresentationSandbox(target, installed, input, () => {}, () => {
      void diagnosticInvoke('report_frontend_diagnostic', { diagnostic: { kind: 'presentation_failed' } }).then(accepted => finishFault(accepted));
    });
    sandbox.activate(); sandbox.update({ ...input, context: { ...input.context, revision: 2 } });
    check(await fault, 'Real Worker fault through trusted presentation bridge must reach native IPC');
    sandbox.dispose(); target.remove();
    for (const fields of [{ level: 'DEBUG' }, { session_id: 'forged' }, { path: '/tmp/diagnostic-native-canary' }, { message: 'diagnostic-native-canary' }]) {
      let denied = false;
      try { await diagnosticInvoke('report_frontend_diagnostic', { diagnostic: { kind: 'exception', ...fields } }); } catch { denied = true; }
      check(denied, 'Unknown diagnostic fields must be rejected');
    }
    await diagnosticInvoke('open_diagnostic_log_directory');
    const folderOpened = await (await fetch('/__diagnostic_folder_opened', { method: 'POST' })).json();
    check(folderOpened.ok, folderOpened.error);
    const config = await (await fetch('/__diagnostic_config')).json();
    if (config.permissionFault) {
      await fetch('/__diagnostic_permission', { method: 'POST' });
      await diagnosticInvoke('report_frontend_diagnostic', { diagnostic: { kind: 'exception', resource: 'src/main.ts', line: 13, column: 8 } });
      for (let attempt = 0; attempt < 100; attempt++) {
        status = await diagnosticInvoke('get_diagnostic_log_status'); if (status.state === 'degraded') break; await delay(50);
      }
      check(status.state === 'degraded' && status.error_code === 'permission_denied', 'Native permission failure must degrade logging');
      check(Array.isArray(await invoke('list_workspaces')), 'Business database remains usable while logging fails');
      await fetch('/__diagnostic_restore', { method: 'POST' });
      for (let attempt = 0; attempt < 800; attempt++) {
        status = await diagnosticInvoke('get_diagnostic_log_status'); if (status.state === 'healthy') break; await delay(50);
      }
      check(status.state === 'healthy', 'Background writer must recover after the retry period');
      check(status.dropped >= 2, 'Write failure drops are counted alongside frontend suppression');
    }
    await delay(1200);
    status = await diagnosticInvoke('get_diagnostic_log_status');
    check(status.dropped >= 1, 'Suppressed records appear in native state');
    await send({ ok: true, stage: 'trusted', status, openedDirectory: true, folderWindow: folderOpened.proof, permissionRecovery: config.permissionFault, childFrameDenied: true, missingAccessDenied, uncaughtFrontendToFile: true, workerIsolation: true });
    await getCurrentWindow().close();
  }
} catch (error) { await send({ ok: false, error: error instanceof Error ? error.message : JSON.stringify(error), accessPresent: typeof window.__AIBO_DIAGNOSTIC_ACCESS__ === 'string', origin: location.origin }); }
