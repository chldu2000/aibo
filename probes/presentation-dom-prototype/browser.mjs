// A bounded experiment, not a production runtime conformance suite.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildPrototype } from './build.mjs';

const { output, sizes } = await buildPrototype();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(path.join(output, 'iframe.html')).href);
  const evidence = [];
  for (const framework of ['react', 'svelte', 'react']) {
    await page.evaluate(name => p0.mount(name), framework);
    await page.waitForFunction(() => p0.stats().active);
    const field = page.frameLocator('iframe').getByRole('textbox', { name: '草稿' });
    await field.fill(`草稿-${framework}`);
    await page.waitForFunction(name => p0.stats().draft === `草稿-${name}`, framework);
    const stats = await page.evaluate(() => p0.stats());
    assert.equal(stats.checks.parentAccess, false);
    assert.equal(stats.checks.tauri, false);
    assert.equal(stats.checks.storage, false);
    evidence.push({ framework, mountMs: stats.lastRenderMs, draft: stats.draft });
  }
  const saved = await page.evaluate(() => p0.stats().draft);
  await page.evaluate(() => p0.mount('svelte'));
  await page.waitForFunction(() => p0.stats().active);
  assert.equal(await page.frameLocator('iframe').getByRole('textbox').inputValue(), saved);

  await page.evaluate(() => p0.attack());
  await page.waitForFunction(() => p0.stats().pending && p0.stats().rejected >= 2);
  assert.equal(await page.evaluate(() => p0.stats().executed), 0);
  await page.locator('#confirm').evaluate(button => button.click());
  assert.equal(await page.evaluate(() => p0.stats().executed), 0, 'synthetic host click cannot approve');
  await page.locator('#confirm').click();
  assert.equal(await page.evaluate(() => p0.stats().executed), 1);
  evidence.push('valid token plus forged isTrusted cannot execute; trusted host browser click confirms once');

  const packet = await page.evaluate(() => p0.packet());
  await page.evaluate(() => p0.update());
  await page.evaluate(packet => p0.receive(packet, p0.stats().generation), packet);
  assert.equal(await page.evaluate(() => p0.stats().pending), null, 'old revision cannot request');
  await page.evaluate(() => p0.suspend(true));
  await page.evaluate(() => p0.receive(p0.packet(), p0.stats().generation));
  assert.equal(await page.evaluate(() => p0.stats().pending), null);
  await page.evaluate(() => p0.suspend(false));
  await page.evaluate(() => { const packet = p0.packet(); p0.receive(packet, p0.stats().generation); p0.invalidate(); });
  await page.locator('#confirm').click();
  assert.equal(await page.evaluate(() => p0.stats().executed), 1, 'changed availability invalidates pending confirmation');
  await page.evaluate(packet => p0.receive(packet, p0.stats().generation - 1), packet);
  evidence.push('stale revision, old generation, suspended requests and revoked actions rejected');

  await page.evaluate(() => p0.dispose());
  assert.equal(await page.locator('iframe').count(), 0);
  assert.equal(await page.evaluate(() => p0.stats().draft), saved);
  // Disposal is idempotent and late messages cannot recreate a pending operation.
  await page.evaluate(packet => { p0.dispose(); p0.receive(packet, packet.generation); }, packet);
  assert.equal(await page.evaluate(() => p0.stats().pending), null);
  const result = { passed: true, browser: browser.version(), scope: 'Chromium, mock effects, browser trusted input; no native IPC/physical input or CPU isolation claim', sizes, evidence };
  await writeFile(path.join(output, 'browser-result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
