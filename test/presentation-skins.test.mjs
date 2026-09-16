import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {buildPresentationSkins} from '../probes/lib/build-presentation-skins.mjs';
import {verifyPresentationPackage} from '../src/lib/presentation-runtime/package.ts';
import {semanticInput,semanticPreflightSnapshots} from '../src/lib/presentation-runtime/semantic.ts';
import {navigationActions} from '../src/lib/presentation-runtime/navigation.ts';
import {createConversationDirectory} from '../src/lib/presentation-runtime/conversation.ts';
import {createGitDirectory} from '../src/lib/presentation-runtime/git.ts';
import {createInspectorDirectory} from '../src/lib/presentation-runtime/inspector.ts';
import {createCapabilityWorkbenchDirectory} from '../src/lib/presentation-runtime/capability-workbench.ts';
import {controlPreflights} from '../src/lib/presentation-runtime/controls.ts';
const flatten=tree=>[tree,...(tree.children??[]).flatMap(flatten)];
test('independent skin tarballs build all themes and render core semantic content and host-bound controls',async t=>{
  const built=await buildPresentationSkins();t.after(built.dispose);
  for(const pkg of built.packages) {
    await verifyPresentationPackage(JSON.stringify(pkg.release.manifest),async name=>Buffer.from(pkg.resources[name],'base64'));
    assert.equal(pkg.release.manifest.themes.length,4);
    const skin=pkg.release.manifest.id.split('.').at(-1);
    const metadata=JSON.parse(await readFile('packages/presentation-'+skin+'/package.json','utf8'));
    assert.equal(pkg.release.manifest.version,metadata.version,'default build uses the package release version');
    assert.equal(metadata.dependencies['@aibo/presentation-workbench'],JSON.parse(await readFile('packages/presentation-workbench/package.json','utf8')).version);
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
    for(const agent of ['codex','pi']) {
      const manifest=JSON.parse(await readFile(`src-tauri/capability-plugins/${agent}/plugin.json`,'utf8'));
      const expected=manifest.contributions[0].icon.path;
      const input=controlPreflights()[1];input.data.props.agent=agent;input.data.props.icon=manifest.contributions[0].icon;
      const nodes=flatten(render(input));
      assert.ok(nodes.some(node=>node.tag==='path'&&node.attrs.d===expected));
      assert.ok(!nodes.some(node=>node.resource),'vectors need no host resource URL');
    }
    const data={};
    for(const name of ['navigation','conversation','git','inspector','capability'])data[name]=JSON.parse(await readFile(`fixtures/presentation-workbench/${name}.json`,'utf8'));
    data.navigationActions=navigationActions(data.navigation);data.conversationActions=createConversationDirectory().project(data.conversation);data.gitActions=createGitDirectory().project(data.git);data.inspectorActions=createInspectorDirectory().project(data.inspector);data.capabilityActions=createCapabilityWorkbenchDirectory().project(data.capability);
    for(const selected of [data.capability.selected,null]){
      data.capability.selected=selected;
      const nodes=flatten(render({surface:'workbench',data}));
      assert.equal(new Set(nodes.map(node=>node.key)).size,nodes.length);
      assert.ok(nodes.some(node=>node.text==='工程动作'));
      if(!selected)assert.ok(nodes.some(node=>node.text==='complete'));
    }
    const matrix=controlPreflights()[0];matrix.data.props.disabled=true;matrix.data.actions=[];
    assert.ok(flatten(render(matrix)).filter(n=>n.tag==='button').every(n=>n.attrs.disabled&&!n.events));
  }
});
