import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
const output = process.env.AIBO_MODEL_EVIDENCE ?? '/tmp/aibo-p2-model-matrix';
await mkdir(output, { recursive: true });
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
const errors = [], results = [];
page.on('pageerror', error => errors.push(String(error)));
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/probes/model-configuration.html`);
  await page.waitForFunction(() => Boolean(window.modelProbe));
  for (const kit of ['shadcn', 'material3']) {
    await page.evaluate(kit => window.modelProbe.render(kit), kit);
    await page.getByRole('button', { name: /Test Model/ }).click();
    assert.equal(await page.getByRole('button', { name: 'Test Model，high', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.getByRole('columnheader', { name: '保留', exact: true }).count(), 1);
    await page.getByRole('button', { name: 'Test Model，medium', exact: true }).click();
    await page.getByRole('button', { name: 'Test Model · medium', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Test Model，medium', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: 'Test Model，保留', exact: true }).click();
    await page.getByRole('button', { name: 'Test Model · medium', exact: true }).waitFor();
    await page.evaluate(() => window.modelProbe.render());
    await page.getByRole('button', { name: 'Test Model · medium', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Test Model，medium', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.screenshot({ path: `${output}/${kit}.png` });
    await page.getByRole('button', { name: 'Test Model，high', exact: true }).click();
    await page.getByRole('button', { name: 'Test Model · high', exact: true }).waitFor();
    results.push({ kit, initialHigh: true, switchMedium: true, preserve: true, remountMedium: true });
  }
  assert.deepEqual(errors, []);
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify(results));
} finally { await browser.close(); await server.close(); }
