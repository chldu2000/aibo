import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

test('the active kit renders one accessible file status language in both themes', async () => {
  const server = await createServer({server:{middlewareMode:true,ws:false,watch:null},appType:'custom'});
  try {
    const { render } = await server.ssrLoadModule('svelte/server');
    const { default: Mark } = await server.ssrLoadModule('/src/lib/ui-kit/runtime/FileChangeMark.svelte');
    const { setUiTheme } = await server.ssrLoadModule('/src/lib/ui-kit/registry.ts');
    for (const theme of ['light','dark']) {
      setUiTheme(theme);
      for (const [kind,symbol,label] of [['added','A','新增'],['modified','M','修改'],['deleted','D','删除'],['renamed','R','重命名'],['conflicted','U','合并冲突']]) {
        const html=render(Mark,{props:{kind}}).body;
        assert.match(html,new RegExp(`data-kind="${kind}"`));
        assert.match(html,new RegExp(`aria-label="${label}"`));
        assert.match(html,new RegExp(`>${symbol}</span>`));
        assert.match(html,/role="img"/);
        const decorative=render(Mark,{props:{kind,decorative:true}}).body;
        assert.match(decorative,/aria-hidden="true"/);
        assert.doesNotMatch(decorative,/role="img"|aria-label=/);
      }
    }
  } finally {await server.close();}
});
