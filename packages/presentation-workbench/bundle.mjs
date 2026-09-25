import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';

/** Bundle the fixed workbench entry and installed dependencies for the Worker. */
export async function workbenchSource() {
  const result = await build({
    stdin: {contents: "export {renderWorkbench} from './workbench.js';", resolveDir: fileURLToPath(new URL('.', import.meta.url))},
    bundle: true, write: false, format: 'iife', globalName: 'aiboWorkbenchModule',
    platform: 'browser', target: 'es2022', minify: true,
  });
  return result.outputFiles[0].text + '\nself.aiboWorkbench=aiboWorkbenchModule.renderWorkbench;\n';
}
