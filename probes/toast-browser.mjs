import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';

// Keep the real AppOverlays and Card components; supply stable notification props.
const server = await createServer({
  server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: null },
  plugins: [{
    name: 'toast-probe', enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('/src/App.svelte')) return;
      return code.replace(/<AppOverlays\s+\{errorMessage\}\s+\{notice\}/,
        '<AppOverlays errorMessage="连接失败，请稍后重试" notice="设置已保存"');
    },
  }],
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  for (const kit of ['ak-ui', 'material3']) for (const theme of ['light', 'dark']) {
    await page.evaluate(({ kit, theme }) => localStorage.setItem('aibo.appearance.v1',
      JSON.stringify({ kitId: kit, themeId: theme })), { kit, theme });
    await page.reload();
    await page.locator('.error-toast').waitFor();
    assert.equal(await page.locator('.app-shell').getAttribute('data-ui-kit'), kit);
    for (const [selector, semantic] of [['.error-toast', 'danger'], ['.notice-toast', 'success']]) {
      const actual = await page.locator(selector).evaluate((element, semantic) => {
        const style = getComputedStyle(element);
        const reference = document.createElement('div');
        reference.style.cssText = `background:var(--aibo-${semantic}-surface);color:var(--aibo-${semantic}-text);border:1px solid var(--aibo-${semantic}-border)`;
        element.parentElement.append(reference);
        const expected = getComputedStyle(reference);
        const result = {
          background: style.backgroundColor, expectedBackground: expected.backgroundColor,
          color: style.color, expectedColor: expected.color,
          border: style.borderTopColor, expectedBorder: expected.borderTopColor,
          shadow: style.boxShadow,
        };
        reference.remove();
        return result;
      }, semantic);
      assert.equal(actual.background, actual.expectedBackground, `${kit}/${theme} ${selector} background`);
      assert.equal(actual.color, actual.expectedColor, `${kit}/${theme} ${selector} text`);
      assert.equal(actual.border, actual.expectedBorder, `${kit}/${theme} ${selector} border`);
      assert.notEqual(actual.shadow, 'none', `${kit}/${theme} ${selector} elevation`);
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.locator('.toast').first().evaluate(e => getComputedStyle(e).animationName), 'none');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    console.log(`PASS ${kit}/${theme}: notification colors, borders, shadows and reduced motion`);
  }
} finally {
  await browser?.close();
  await server.close();
}
