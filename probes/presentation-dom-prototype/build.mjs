import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile, compileModule } from 'svelte/compiler';

const require = createRequire(import.meta.url);
const viteRequire = createRequire(require.resolve('vite/package.json'));
const { build } = viteRequire('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const svelte = { name: 'p0-svelte', setup(builder) {
  builder.onLoad({ filter: /\.svelte$/ }, async args => ({ contents: compile(await readFile(args.path, 'utf8'), { filename: args.path, generate: 'client', dev: false }).js.code, loader: 'js' }));
  builder.onLoad({ filter: /\.svelte\.js$/ }, async args => ({ contents: compileModule(await readFile(args.path, 'utf8'), { filename: args.path, dev: false }).js.code, loader: 'js' }));
} };
const style = 'body{font:15px system-ui;margin:20px;color:#202020;background:#fafafa}button{padding:8px;margin:4px}textarea{display:block;width:95%;height:65px}iframe{width:100%;height:290px;border:1px solid #bbb}pre{white-space:pre-wrap;font-size:12px}#draft,#pending{padding:8px;background:#eee}';
const escapeScript = value => value.replaceAll('</script', '<\\/script');
async function bundle(entry) {
  const result = await build({ entryPoints: [path.join(here, entry)], absWorkingDir: root, bundle: true, write: false,
    format: 'iife', platform: 'browser', conditions: ['browser', 'production'], minify: true, legalComments: 'none',
    define: { 'process.env.NODE_ENV': '"production"' }, plugins: [svelte], nodePaths: [path.join(root, 'node_modules')] });
  return result.outputFiles[0].text;
}
export async function buildPrototype(output = path.join(here, 'dist')) {
  await mkdir(output, { recursive: true });
  const documents = {}, sizes = {};
  for (const [name, entry] of [['react', 'react.jsx'], ['svelte', 'svelte.svelte.js']]) {
    const source = await bundle(entry); sizes[name] = Buffer.byteLength(source);
    documents[name] = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'"><style>${style}</style><div id="app"></div><script>${escapeScript(source)}</script>`;
    const nativeDocument = documents[name].replace("connect-src 'none'", "connect-src ipc: http://ipc.localhost").replace('<script>', '<script>window.p0Tauri=true;');
    await writeFile(path.join(output, `${name}.html`), nativeDocument);
  }
  const host = await bundle('host.mjs');
  const intro = `<h1>框架无关呈现 P0 原型</h1><p>验证：两个框架能否共享宿主草稿？插件主动请求能否绕过确认？死循环是否阻塞宿主？所有发送均为模拟，无真实 Agent 或文件写入。</p>
  <p>操作顺序：挂载 → 编辑草稿 → 切换框架 → 伪造请求 → 宿主确认。死循环实验请使用带外部超时的 probe 命令。</p>
  <button id="react">挂载 React</button><button id="svelte">挂载 Svelte</button><button id="attack">伪造请求</button><button id="confirm">宿主确认</button><button id="suspend">挂起/恢复动作</button><button id="recover">恢复内置</button><button id="loop">插件死循环</button>
  <p id="status"></p><p id="draft"></p><p id="pending"></p><div id="surface"></div><pre id="log"></pre>`;
  for (const mode of ['iframe', 'webview']) {
    const html = `<!doctype html><meta charset="utf-8"><title>Aibo P0 prototype</title><style>${style}</style>${intro}<script>window.p0Container=${JSON.stringify(mode)};window.p0Documents=${JSON.stringify(documents).replaceAll('<', '\\u003c')};</script><script>${escapeScript(host)}</script>`;
    await writeFile(path.join(output, `${mode}.html`), html);
  }
  await writeFile(path.join(output, 'build.json'), JSON.stringify({ sizes, react: require('react/package.json').version, svelte: require('svelte/package.json').version }, null, 2));
  return { output, sizes };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(await buildPrototype());
