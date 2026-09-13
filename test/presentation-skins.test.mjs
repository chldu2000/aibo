import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {buildPresentationSkins} from '../probes/lib/build-presentation-skins.mjs';
import {verifyPresentationPackage} from '../src/lib/presentation-runtime/package.ts';
import {semanticInput,semanticPreflightSnapshots} from '../src/lib/presentation-runtime/semantic.ts';
import {controlPreflights} from '../src/lib/presentation-runtime/controls.ts';
const flatten=tree=>[tree,...(tree.children??[]).flatMap(flatten)];
test('independent skin tarballs build all themes and render core semantic content and host-bound controls',async t=>{
  const built=await buildPresentationSkins();t.after(built.dispose);
  for(const pkg of built.packages) {
    await verifyPresentationPackage(JSON.stringify(pkg.release.manifest),async name=>Buffer.from(pkg.resources[name],'base64'));
    assert.equal(pkg.release.manifest.themes.length,4);
    const context={self:{}};vm.runInNewContext(Buffer.from(pkg.resources['skin.js'],'base64').toString(),context);
    const render=context.self.aiboPresentation.render;
    for(const snapshot of [...semanticPreflightSnapshots(),...await Promise.all(['collection','detail','partial-detail','loading','empty','error','unavailable'].map(async name=>JSON.parse(await readFile(`fixtures/semantic-git/${name}.json`,'utf8'))))]) {
      const input=semanticInput(snapshot,1),tree=render(input),nodes=flatten(tree);
      assert.equal(new Set(nodes.map(n=>n.key)).size,nodes.length,'unique restoration keys');
      assert.ok(nodes.some(n=>n.text===snapshot.contribution.title));
      if(snapshot.view.kind!=='collection')assert.ok(nodes.some(n=>n.text===snapshot.view.content));
      for(const action of input.data.actions)assert.ok(nodes.some(n=>n.events?.click===action.token));
    }
    for(const input of controlPreflights()) {
      const nodes=flatten(render(input));
      for(const action of input.data.actions)assert.ok(nodes.some(n=>n.events?.click===action.token));
    }
    const matrix=controlPreflights()[0];matrix.data.props.disabled=true;matrix.data.actions=[];
    assert.ok(flatten(render(matrix)).filter(n=>n.tag==='button').every(n=>n.attrs.disabled&&!n.events));
  }
});
