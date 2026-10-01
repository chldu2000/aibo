// Real App, real Tauri IPC and system browser; only conversation data is a fixture.
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createBuiltinWorkbenchServer} from './lib/builtin-workbench-fixture.mjs';

if (process.platform !== 'darwin') throw Error('This native probe currently targets macOS');
const root = await mkdtemp(path.join(tmpdir(), 'aibo-links-'));
let finish, opened = false;
const report = new Promise(resolve => { finish = resolve; });
const server = await createBuiltinWorkbenchServer({markdown:'[网页测试](http://127.0.0.1:1/__opened)', plugins:[{
  name:'native-link-probe', enforce:'pre',
  transform(code,id) {
    if (!id.endsWith('/src/App.svelte')) return;
    return code.replace('const runningDesktop = isTauri();', 'const runningDesktop = false;')
      .replaceAll('http://127.0.0.1:1/__opened', `http://127.0.0.1:${server.httpServer.address().port}/__opened`);
  },
  configureServer(server) {
    server.middlewares.use('/__opened', (_req,res) => { opened = true; res.end('Aibo link opened successfully. You can close this tab.'); });
    server.middlewares.use('/__link_report', (req,res) => {
      res.end('ok'); finish({opened, error:new URL(req.url,'http://localhost').searchParams.get('error')});
    });
  },
  transformIndexHtml() {
    return [{tag:'script',attrs:{type:'module'},children:`
      import {invoke} from '/node_modules/@tauri-apps/api/core.js';
      const timer = setInterval(async () => {
        const link = [...document.querySelectorAll('.markdown-content a')].find(a => a.textContent === '网页测试');
        if (!link) return;
        clearInterval(timer);
        try {
          for (const url of ['file:///tmp/aibo-link-probe', 'javascript:void(0)', 'custom:aibo-link-probe']) {
            let denied = false;
            try { await invoke('plugin:opener|open_url', {url}); } catch { denied = true; }
            if (!denied) throw Error('Native scope allowed unsupported URL: ' + url);
          }
          link.click();
          setTimeout(() => fetch('/__link_report'), 5000);
        } catch (error) { fetch('/__link_report?error=' + encodeURIComponent(String(error))); }
      }, 100);
    `}];
  },
}]});
await server.listen();
const config = path.join(root,'tauri.json');
await writeFile(config, JSON.stringify({identifier:`local.aibo.linksprobe.${Date.now()}`,build:{beforeDevCommand:'',devUrl:`http://127.0.0.1:${server.httpServer.address().port}`}}));
const child = spawn('pnpm',['tauri','dev','--no-watch','--config',config],{stdio:['ignore','pipe','pipe'],detached:true});
child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
let timer;
try {
  const result = await Promise.race([report, new Promise((_,reject) => { timer=setTimeout(() => reject(Error('Native link probe timed out')),180000); }),new Promise((_,reject) => child.once('exit',code => reject(Error(`Tauri exited: ${code}`))))]);
  assert.equal(result.error,null);
  assert.equal(result.opened,true,'clicking an answer link must open its destination in the system browser');
  console.log('PASS: answer link opened through the system browser; native scope rejects unsupported URLs');
} finally {
  clearTimeout(timer);
  const exited = child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise(resolve => child.once('exit',resolve));
  try { process.kill(-child.pid,'SIGTERM'); } catch {}
  await exited; await server.close(); await rm(root,{recursive:true,force:true});
}
