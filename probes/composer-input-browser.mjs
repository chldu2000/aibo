import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';

// Seed only the preview data; exercise App's real rendering and event chain.
const server = await createServer({
  server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: null },
  plugins: [{ name: 'composer-preview-session', enforce: 'pre', transform(code, id) {
    if (!id.endsWith('/src/App.svelte')) return;
    return code.replace('workspaces = previewWorkspaces;', `workspaces = previewWorkspaces;
      workspaceSessionMap = { 'preview-workspace': ['a', 'b'].map(id => ({
        id, workspaceId: 'preview-workspace', agent: 'dev.aibo.codex.agent',
        label: 'Input session ' + id, state: 'idle', archived: false,
        externalSessionId: null, pluginInstallationId: 'fixture', capabilities: [],
        createdAt: '2026-09-12', updatedAt: '2026-09-12'
      })) };
      setTimeout(() => { selectedSessionId = 'a'; }, 100);`);
  } }],
});
await server.listen();
const browser = await chromium.launch({ headless: true });
try {
  for (const kit of ['light', 'dark']) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  await page.evaluate(async kit => (await import('/src/lib/ui-kit/registry.ts')).setUiTheme(kit), kit);
  const input = page.locator('[data-composer-input]');
  await input.waitFor();
  await input.click();
  await page.keyboard.type('hello');
  assert.equal(await input.inputValue(), 'hello');
  await page.getByText('Input session b', { exact: true }).click();
  await input.click();
  await page.keyboard.type('world');
  assert.equal(await input.inputValue(), 'world');
  await page.keyboard.insertText('，你好');
  assert.equal(await input.inputValue(), 'world，你好');
  await page.getByRole('button', { name: '专注会话', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-presentation-layout="focus"][aria-busy="false"]'));
  assert.equal(await input.inputValue(), 'world，你好', 'host draft must survive presentation remount');
  await input.press('End');
  await page.keyboard.type('!');
  assert.equal(await input.inputValue(), 'world，你好!');
  await page.keyboard.press('Control+Shift+Backspace');
  await page.getByText('Input session a', { exact: true }).click();
  await input.fill('back in a');
  assert.equal(await input.inputValue(), 'back in a');
  assert.equal(await page.getByRole('button', { name: '发送', exact: true }).isEnabled(), true);
  // @references render as tags in a mirror layer; it must share the textarea's exact box or the caret drifts.
  await input.fill('请看 @src/lib/ui-kit/contract.ts 然后 ' + '换行文字 '.repeat(40) + '\n'.repeat(12) + '@docs/x.md 末尾');
  const mirror = await page.evaluate(() => {
    const read = node => { const c = getComputedStyle(node); const b = node.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, pad: c.padding, border: c.borderWidth, font: c.font, ws: c.whiteSpace, wrap: c.overflowWrap, gutter: c.scrollbarGutter, scrollHeight: node.scrollHeight }; };
    const textarea = document.querySelector('[data-composer-input]'); const layer = document.querySelector('.composer-mention-layer');
    textarea.scrollTop = 99999; textarea.dispatchEvent(new Event('scroll'));
    return { textarea: read(textarea), layer: read(layer), glyphs: getComputedStyle(textarea).color, caret: getComputedStyle(textarea).caretColor, tags: [...document.querySelectorAll('.composer-mention')].map(m => m.textContent), scroll: [textarea.scrollTop, layer.scrollTop] };
  });
  assert.deepEqual(mirror.layer, mirror.textarea, 'mention layer mirrors the textarea box, typography, wrapping and scroll height');
  assert.equal(mirror.glyphs, 'rgba(0, 0, 0, 0)', 'textarea glyphs are transparent so the draft is painted once, by the layer');
  assert.notEqual(mirror.caret, 'rgba(0, 0, 0, 0)', 'caret stays visible');
  assert.deepEqual(mirror.tags, ['@src/lib/ui-kit/contract.ts', '@docs/x.md']);
  assert.equal(mirror.scroll[0], mirror.scroll[1], 'layer follows textarea scrolling');
  assert(mirror.scroll[0] > 0, 'fixture overflows so the scroll sync is exercised');
  await input.fill('back in a');
  assert.deepEqual(errors, []);
  console.log(`${kit}: initial selection, session switches, typing and presentation remount passed`);
  await page.close();
  }
} finally { await browser.close(); await server.close(); }
