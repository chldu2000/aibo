import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

test('context dropdown renders confirmed values and disabled fallback in both skins', async () => {
  const server = await createServer({ server: { middlewareMode: true, ws: false, watch: null }, appType: 'custom' });
  try {
    const { render } = await server.ssrLoadModule('svelte/server');
    const { default: Select } = await server.ssrLoadModule('/src/lib/ui-kit/runtime/ModelContextSelect.svelte');
    const { setUiKit } = await server.ssrLoadModule('/src/lib/ui-kit/registry.ts');
    for (const kit of ['shadcn', 'material3']) {
      setUiKit(kit);
      const props = { current: 'long', options: [{ id: 'standard', label: '128K', description: null }, { id: 'long', label: '1M', description: 'Extended context' }], disabled: false, onSelect() {} };
      const html = render(Select, { props }).body;
      assert.match(html, /aria-label="模型上下文大小"/);
      assert.match(html, /<option[^>]*value="long"[^>]*selected/);
      assert.doesNotMatch(html, /<select[^>]*disabled/);
      assert.match(render(Select, { props: { ...props, disabled: true } }).body, /<select[^>]*disabled/);
      const fallback = render(Select, { props: { ...props, options: [], current: null } }).body;
      assert.match(fallback, /<select[^>]*disabled/); assert.match(fallback, /不支持/);
    }
  } finally { await server.close(); }
});
