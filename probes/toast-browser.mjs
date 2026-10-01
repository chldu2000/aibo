import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';

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
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
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
          reference.style.cssText = `background:var(${surface});color:var(${text});border:1px solid var(--aibo-${semantic}-text)`;
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
        colors.push(actual.signal);
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
        await page.screenshot({ animations: 'disabled', path: `/tmp/aibo-notifications/${kit}-${theme}-${type}.png` });
        await page.setViewportSize({ width: 1280, height: 900 });
      }
      assert.equal(new Set(colors).size, 4, 'all four status signals are distinct');
      // The existing exception channel remains visible alongside typed feedback.
      await page.evaluate(() => {
        window.__toastProbe.notify('设置已保存', 'success');
        window.__toastProbe.error('连接失败');
      });
      await page.locator('.success-toast').waitFor();
      await page.locator('.error-toast').waitFor();
      assert.equal(await page.locator('.toast').count(), 2);
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
