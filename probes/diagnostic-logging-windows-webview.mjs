import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const [port, directory, pidText, evidencePath, screenshotPath] = process.argv.slice(2);
assert.equal(process.platform, 'win32', 'Connect to the installed Windows application');
const pid = Number(pidText);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const deadline = Date.now() + 30000;
let browser;
while (!browser) {
  try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${Number(port)}`, { timeout: 2000, isWebView: true, noDefaults: true }); }
  catch (error) { if (Date.now() >= deadline) throw error; await delay(100); }
}
try {
  const page = browser.contexts().flatMap(context => context.pages()).find(page => /^https?:\/\/tauri\.localhost\//.test(page.url()));
  assert(page, 'Actual installed Tauri main document must exist');
  page.setDefaultTimeout(20000);
  const boundary = await page.evaluate(async () => {
    const invoke = (command, args, credential = true) => window.__TAURI_INTERNALS__.invoke(command, args,
      credential ? { headers: { 'Aibo-Diagnostic-Access': window.__AIBO_DIAGNOSTIC_ACCESS__ } } : undefined);
    let missingAccessDenied = false;
    try { await invoke('report_frontend_diagnostic', { diagnostic: { kind: 'exception' } }, false); }
    catch { missingAccessDenied = true; }
    const invalidFields = [];
    for (const field of [{ level: 'DEBUG' }, { session_id: 'forged' }, { path: 'diagnostic-windows-secret-canary' }, { message: 'diagnostic-windows-secret-canary' }]) {
      let denied = false;
      try { await invoke('report_frontend_diagnostic', { diagnostic: { kind: 'exception', ...field } }); }
      catch { denied = true; }
      invalidFields.push(denied);
    }
    const frame = document.createElement('iframe');
    frame.id = 'windows-diagnostic-frame';
    frame.setAttribute('sandbox', 'allow-scripts');
    // Load the production bridge under its real CSP, with an opaque origin.
    frame.src = '/aibo-presentation-sandbox.html';
    document.body.append(frame);
    return { missingAccessDenied, invalidFields };
  });
  const frameDeadline = Date.now() + 10000;
  let frame;
  while (!frame) {
    frame = page.frames().find(candidate => candidate.url().endsWith('/aibo-presentation-sandbox.html'));
    assert(Date.now() < frameDeadline, 'Production opaque bridge must load');
    if (!frame) await delay(100);
  }
  await frame.waitForLoadState('domcontentloaded');
  const childFrame = await frame.evaluate(async () => {
    const access = typeof window.__AIBO_DIAGNOSTIC_ACCESS__ === 'string';
    let denied = true;
    if (window.__TAURI_INTERNALS__?.invoke) {
      try { await window.__TAURI_INTERNALS__.invoke('report_frontend_diagnostic', { diagnostic: { kind: 'exception' } }); denied = false; }
      catch { /* The real native receiver must reject this source. */ }
    }
    return { access, denied };
  });
  await page.evaluate(() => {
    document.getElementById('windows-diagnostic-frame').remove();
    // These are actual uncaught browser events, handled by production listeners.
    setTimeout(() => { throw Error('diagnostic-windows-secret-canary'); }, 0);
    void Promise.reject({ password: 'diagnostic-windows-secret-canary' });
  });
  assert(boundary.missingAccessDenied);
  assert(boundary.invalidFields.every(Boolean));
  assert(childFrame.denied && !childFrame.access);
  await page.locator('[data-host-navigation="management"]').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: /^(Runtime and diagnostics|运行与诊断)$/ }).click();
  const panel = dialog.locator('[aria-labelledby="diagnostic-logs-title"]');
  await panel.getByText(directory, { exact: true }).waitFor();
  await panel.getByRole('button', { name: /^(Open log folder|打开日志文件夹)$/ }).focus();
  await page.keyboard.press('Enter');
  await page.screenshot({ path: screenshotPath });
  const fileDeadline = Date.now() + 10000;
  let rows;
  do {
    rows = [];
    for (const name of await readdir(directory)) {
      if (!name.endsWith('.jsonl') && !name.endsWith('.run')) continue;
      const text = await readFile(path.join(directory, name), 'utf8');
      assert(!text.includes('diagnostic-windows-secret-canary'), 'Synthetic secrets must not be saved');
      if (!name.endsWith('.jsonl')) continue;
      const lines = text.split('\n'); if (!text.endsWith('\n')) lines.pop();
      rows.push(...lines.filter(Boolean).map(line => JSON.parse(line)).filter(row => row.pid === pid));
    }
    if (['frontend.exception', 'frontend.unhandled_rejection'].every(event => rows.some(row => row.event === event))) break;
    await delay(100);
  } while (Date.now() < fileDeadline);
  for (const event of ['frontend.exception', 'frontend.unhandled_rejection']) {
    const matching = rows.filter(row => row.event === event);
    assert.equal(matching.length, 1, `${event} written exactly once by the native receiver`);
    assert.equal(matching[0].window_id, 'main');
  }
  await writeFile(evidencePath, JSON.stringify({ passed: true, installedWebView2: true,
    missingAccessDenied: boundary.missingAccessDenied, unknownFieldsDenied: boundary.invalidFields.every(Boolean),
    opaqueFrameDenied: true, keyboardDirectoryAction: true,
    events: rows.filter(row => row.event.startsWith('frontend.')).map(row => ({ boot_id: row.boot_id, event: row.event, window_id: row.window_id })) }, null, 2));
  console.log('Installed Windows WebView2: real frontend events, IPC boundaries and keyboard directory action passed');
} finally {
  await browser.close(); // Disconnect from the externally owned WebView2.
}
