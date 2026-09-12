import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';

test('public semantic contract and projection have no transitive renderer or platform dependencies', async () => {
  const visited=new Set();
  async function check(file) {
    if(visited.has(file))return;visited.add(file);
    const source=await readFile(file,'utf8');
    assert.doesNotMatch(source,/\b(?:Component|ReactNode|VNode|HTMLElement|CSSProperties|Storage|Document|Window)\b/);
    const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
    for(const node of ast.statements) {
      if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier) {
        const spec=node.moduleSpecifier.text;assert.ok(spec.startsWith('.'),`external dependency ${spec}`);
        const target=path.resolve(path.dirname(file),spec.endsWith('.js')?spec.slice(0,-3)+'.ts':spec.endsWith('.ts')?spec:spec+'.ts');
        const inPackage=file.startsWith(path.resolve('packages/plugin-protocol/src')+path.sep);
        const roots=inPackage?['packages/plugin-protocol/src']:['src/lib/presentation','packages/plugin-protocol/src'];
        assert.ok(roots.some(root=>target.startsWith(path.resolve(root)+path.sep)),`escaped data boundary ${target}`);await check(target);
      }
    }
    if(file.endsWith('contract.ts') || file.startsWith(path.resolve('packages/plugin-protocol/src')+path.sep)) {
      function visit(node){assert.ok(!ts.isFunctionTypeNode(node)&&!ts.isMethodSignature(node),'wire types cannot carry callbacks');ts.forEachChild(node,visit);}visit(ast);
    }
  }
  await check(path.resolve('src/lib/presentation/renderer-contract.ts'));await check(path.resolve('src/lib/presentation/workbench-contract.ts'));await check(path.resolve('src/lib/presentation/presentation-contract.ts'));await check(path.resolve('src/lib/presentation/contract.ts'));await check(path.resolve('src/lib/presentation/git.ts'));
  await check(path.resolve('packages/plugin-protocol/src/index.ts'));
  const program=ts.createProgram(['src/lib/presentation/presentation-contract.ts','src/lib/presentation/contract.ts','src/lib/presentation/git.ts'],{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,lib:['lib.es2022.d.ts'],types:[],strict:true,noEmit:true,allowImportingTsExtensions:true,skipLibCheck:true});
  assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d=>ts.flattenDiagnosticMessageText(d.messageText,' ')),[]);
});

test('workbench obeys the same visual seam, layout CSS and business dependency rules', async () => {
  async function* files(directory) {
    for (const entry of await readdir(directory,{withFileTypes:true})) {
      const filename=path.join(directory,entry.name);
      if(entry.isDirectory()) yield* files(filename);
      else yield filename;
    }
  }
  for await(const name of files('src/lib/workbench')) {
    const source=await readFile(name,'utf8');
    assert.doesNotMatch(source,/from ['"][^'"]*(?:\/api|components\/ui|@lucide|iconset-material)/);
    assert.doesNotMatch(source,/\b(?:shadcn|material3|data-ui-kit|data-ui-theme)\b/);
    if(name.endsWith('.svelte')) {
      assert.match(source,/from ['"]\$lib\/ui-kit['"]/);
      for(const [,style] of source.matchAll(/<style[^>]*>([\s\S]+?)<\/style>/g))assert.doesNotMatch(style,/\b(?:color|background|border|font|box-shadow|transition|animation|outline)[\w-]*\s*:/);
    }
  }
  for(const skin of ['shadcn','material3']) assert.match(await readFile(`src/lib/ui-kit/kits/${skin}.ts`,'utf8'),/\bSemanticView\b/);
  assert.match(await readFile('src/lib/ui-kit/contract.ts','utf8'),/SemanticView: Component<PresentationProps>/);
});
