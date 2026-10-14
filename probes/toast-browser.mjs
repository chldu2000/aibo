import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { assertMaterial3Tokens } from './lib/material3-token-scan.mjs';

// Exercise the real producer, expiry effect, AppOverlays and Card components.
// The bridge exists only in this browser fixture, never in the shipped app.
const server = await createServer({
  server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: null },
  plugins: [{
    name: 'toast-probe', enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('/src/App.svelte')) return;
      return code.replace('</script>', `
        (window as any).__toastProbe = {
          notify: setNotice,
          error: (message: string | null) => { errorMessage = message; },
        };
        </script>`);
    },
  }],
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({locale:'zh-CN', viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  await mkdir('/tmp/aibo-notifications', { recursive: true });
  const labels = { success: '成功', info: '信息', warning: '警告', error: '错误' };
  for (const kit of ['ak-ui', 'material3']) {
    const themes = kit === 'ak-ui' ? ['light', 'dark'] : ['light', 'dark', 'forest-light', 'forest-dark', 'plum-light', 'plum-dark'];
    for (const theme of themes) {
      await page.evaluate(({ kit, theme }) => localStorage.setItem('aibo.appearance.v1',
        JSON.stringify({ kitId: kit, themeId: theme })), { kit, theme });
      await page.reload();
      await page.waitForFunction(() => window.__toastProbe);
      assert.equal(await page.locator('.app-shell').getAttribute('data-ui-kit'), kit);
      const colors = [];
      for (const type of Object.keys(labels)) {
        await page.evaluate(type => window.__toastProbe.notify('通知正文 / notification ' + '长内容'.repeat(35), type), type);
        const toast = page.locator(`[data-notification-type="${type}"]`);
        await toast.waitFor();
        const semantic = type === 'error' ? 'danger' : type;
        const actual = await toast.evaluate((element, { semantic, kit }) => {
          const style = getComputedStyle(element);
          const reference = document.createElement('div');
          const surface = kit === 'ak-ui' ? '--ak-surface-raised' : '--md-aibo-surface-inverse';
          const text = kit === 'ak-ui' ? '--aibo-text' : '--md-aibo-text-inverse';
          // ak-ui colours the status signal; M3 Snackbar icons stay inverse-on-surface and differ by shape.
          const signal = kit === 'ak-ui' ? `var(--aibo-${semantic}-text)` : `var(${text})`;
          reference.style.cssText = `background:var(${surface});color:var(${text});border:1px solid ${signal}`;
          element.parentElement.append(reference);
          const expected = getComputedStyle(reference);
          const result = {
            background: style.backgroundColor, expectedBackground: expected.backgroundColor,
            color: style.color, expectedColor: expected.color,
            signal: getComputedStyle(element.querySelector('.toast-symbol')).color, expectedSignal: expected.borderTopColor,
            borderWidth: style.borderLeftWidth, border: style.borderLeftColor,
            shadow: style.boxShadow,
          };
          reference.remove();
          return result;
        }, { semantic, kit });
        assert.equal(actual.background, actual.expectedBackground, `${kit}/${theme} ${type} background`);
        assert.equal(actual.color, actual.expectedColor, `${kit}/${theme} ${type} text`);
        assert.equal(actual.signal, actual.expectedSignal, `${kit}/${theme} ${type} signal`);
        assert.equal(actual.borderWidth, kit === 'ak-ui' ? '3px' : '0px');
        if (kit === 'ak-ui') assert.equal(actual.border, actual.expectedSignal);
        assert.notEqual(actual.shadow, 'none', `${kit}/${theme} ${type} elevation`);
        colors.push(kit === 'ak-ui' ? actual.signal : await toast.locator('svg path').first().getAttribute('d'));
        assert.equal(await toast.locator('.toast-label').textContent(), labels[type]);
        assert.ok(await toast.locator('svg path').getAttribute('d'));
        assert.equal(await toast.getAttribute('role'), type === 'error' ? 'alert' : 'status');
        assert.equal(await toast.getAttribute('aria-live'), type === 'error' ? 'assertive' : 'polite');
        await page.setViewportSize({ width: 800, height: 650 });
        assert.ok(await toast.evaluate(e => {
          const rect = e.getBoundingClientRect();
          return rect.left >= 0 && rect.right <= innerWidth && e.scrollWidth <= e.clientWidth + 1;
        }), 'long notification stays within a narrow desktop viewport');
        await page.emulateMedia({ reducedMotion: 'reduce' });
        assert.equal(await toast.evaluate(e => getComputedStyle(e).animationName), 'none');
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await assertMaterial3Tokens(page, `snackbar ${theme} ${type}`);
        await page.screenshot({ animations: 'disabled', path: `/tmp/aibo-notifications/${kit}-${theme}-${type}.png` });
        await page.setViewportSize({ width: 1280, height: 900 });
      }
      assert.equal(new Set(colors).size, 4, 'all four status signals are distinct (colour in ak-ui, icon shape in M3)');
      // The existing exception channel remains visible alongside typed feedback.
      await page.evaluate(() => {
        window.__toastProbe.notify('设置已保存', 'success');
        window.__toastProbe.error('连接失败');
      });
      await page.locator('.success-toast').waitFor();
      await page.locator('.error-toast').waitFor();
      assert.equal(await page.locator('.toast').count(), 2);
      // Both notification channels must stay compact even with huge runtime errors.
      await page.setViewportSize({ width: 800, height: 480 });
      for (const message of ['错误堆栈\n'.repeat(2000), 'x'.repeat(20000)]) {
        await page.evaluate(message => {
          window.__toastProbe.notify(message, 'warning');
          window.__toastProbe.error(message);
        }, message);
        const bounds = await page.locator('.toast-copy > span').evaluateAll(nodes => nodes.map(node => {
          const rect = node.getBoundingClientRect();
          const lineHeight = parseFloat(getComputedStyle(node).lineHeight);
          return { height: rect.height, limit: Math.min(4 * lineHeight, innerHeight * .2),
            clipped: node.scrollHeight > node.clientHeight, text: node.textContent,
            fits: rect.left >= 0 && rect.right <= innerWidth };
        }));
        assert.equal(bounds.length, 2);
        for (const bound of bounds) {
          assert(bound.height <= bound.limit + 1, 'long message is capped at four lines and 20% of viewport height');
          assert(bound.clipped, 'overflowing message is visually truncated');
          assert(bound.fits, 'unbroken error text stays within the viewport');
          assert.equal(bound.text, message, 'full error remains available in the accessible text');
        }
        assert(await page.locator('.toast-region').evaluate(node => node.getBoundingClientRect().height < innerHeight * .6),
          'two long notifications do not cover the window');
      }
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.evaluate(() => { window.__toastProbe.notify(null); window.__toastProbe.error(null); });
      await page.waitForFunction(() => !document.querySelector('.toast'));
      console.log(`PASS ${kit}/${theme}: four types, icons, labels, semantics, narrow layout and reduced motion`);
    }
  }
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await page.evaluate(() => window.__toastProbe.notify('重复通知', 'info'));
  await page.locator('.info-toast').waitFor();
  await page.clock.runFor(3000);
  await page.evaluate(() => window.__toastProbe.notify('重复通知', 'info'));
  await page.clock.runFor(1000);
  assert.equal(await page.locator('.info-toast').count(), 1, 'same-text notification restarts its lifetime');
  await page.clock.runFor(2700);
  assert.equal(await page.locator('.toast').count(), 0);
  for (const type of ['warning', 'error']) {
    await page.evaluate(type => window.__toastProbe.notify('需要留意的通知', type), type);
    await page.locator(`.${type}-toast`).waitFor();
    await page.clock.runFor(4000);
    assert.equal(await page.locator('.toast').count(), 1, 'warning/error gets longer reading time');
    await page.clock.runFor(2100);
    assert.equal(await page.locator('.toast').count(), 0);
  }
  assert.deepEqual(errors, []);
  console.log('PASS expiry, replacement, repeated messages and existing error channel');
} finally {
  await browser?.close();
  await server.close();
}
