import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/probes/semantic-ui.html`);
  await page.waitForFunction(() => Boolean(window.semanticProbe));
  await page.evaluate(async () => {
    await window.semanticProbe.dispose();
    await import('/probes/workbench-recovery-client.mjs');
  });
  const standard = page.locator('[data-presentation-layout="standard"]:not([inert])');
  await standard.waitFor();
  const restore = page.getByRole('button', { name: '恢复默认呈现', exact: true });
  assert.equal(await restore.isEnabled(), true);
  await page.getByRole('button', { name: '切换工作台呈现', exact: true }).click();
  await page.locator('[data-presentation-layout="focus"]:not([inert])').waitFor({timeout: 5000}).catch(async error => { console.log(await page.locator('body').innerText(), errors); throw error; });
  await page.getByRole('textbox', { name: 'draft' }).focus();
  await page.keyboard.press('Control+Shift+Backspace');
  await standard.waitFor();
  assert.equal(await page.getByRole('textbox', { name: 'draft' }).inputValue(), 'keep');
  await page.evaluate(() => window.recoveryWorkbench.switchPresentation('focus', true));
  await standard.waitFor();
  await restore.click();
  await standard.waitFor();
  assert.equal(await page.getByRole('alert').count(), 0);
  assert.deepEqual(errors, []);
  console.log('Workbench persistent recovery button, capture shortcut and mount-failure recovery passed');
} finally { await browser.close(); await server.close(); }
