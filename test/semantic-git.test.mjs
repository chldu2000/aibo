import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { assertSnapshot } from '../src/lib/presentation/validation.ts';
import { actionMessage, projectGit } from '../src/lib/presentation/git.ts';
import { createGitController } from '../src/lib/presentation/git-controller.ts';
const read = async name => JSON.parse(await readFile(`fixtures/semantic-git/${name}.json`, 'utf8'));
const deferred = () => { let resolve, reject; const promise = new Promise((yes,no) => { resolve=yes;reject=no; });return {promise,resolve,reject}; };

test('semantic fixtures validate and reject layout, executable fields, invalid enum and unbounded content', async () => {
  for (const name of ['collection','detail','empty','loading','error','unavailable','partial','partial-detail']) assertSnapshot(await read(name));
  const source = await read('collection');
  for (const mutate of [s=>s.view.class='css',s=>s.view.script='alert(1)',s=>s.view.items[0].values.status='invalid',s=>s.view.items.push(s.view.items[0]),s=>s.view.items=Array(51).fill(s.view.items[0]),s=>s.view.page.total=-1,s=>s.actions.push(s.actions[0]),s=>s.contribution.extensionPoint='sidebar.item']) {
    const snapshot=structuredClone(source);mutate(snapshot);assert.throws(()=>assertSnapshot(snapshot));
  }
  const detail=await read('detail');detail.view.content='x'.repeat(210001);assert.throws(()=>assertSnapshot(detail));
});

test('same semantic action has no renderer fields and rejects disabled or unregistered selections', async () => {
  const snapshot=await read('collection');
  assert.deepEqual(actionMessage(snapshot,'open-diff',snapshot.view.items[0].id),{context:snapshot.context,actionId:'open-diff',itemId:'worktree:src/App.svelte'});
  assert.throws(()=>actionMessage(snapshot,'previous'));
  assert.throws(()=>actionMessage(snapshot,'open-diff','/outside'));
  assert.throws(()=>actionMessage(snapshot,'refresh','unexpected'));
});

test('workspace switches and disposed controllers discard late reads and release their leases', async () => {
  const first=deferred(),second=deferred(),released=[];let latest;
  const controller=createGitController({open:id=>id==='a'?first.promise:second.promise,act:async()=>{throw Error('unused');},release:async id=>released.push(id)},s=>latest=s);
  const a=controller.open('a'),b=controller.open('b');
  const page=await read('source-page');
  second.resolve({...page,context:{...page.context,workspaceId:'b',generation:'b'}});await b;
  first.resolve({...page,context:{...page.context,workspaceId:'a',generation:'a'}});await a;
  assert.equal(latest.context.workspaceId,'b');assert.ok(released.includes('a'));
  controller.dispose();assert.equal(latest,null);assert.ok(released.includes('b'));
});

test('read failure remains retryable without inventing a host generation', async () => {
  let fail=true,latest;
  const page=await read('source-page');
  const controller=createGitController({open:async()=>{if(fail)throw Error('provider_unavailable');return page;},act:async()=>page,release:async()=>{}},s=>latest=s);
  await controller.open('fixture-workspace');assert.equal(latest.state.status,'error');assert.equal(latest.context.generation,'');
  fail=false;await controller.act(actionMessage(latest,'refresh'));assert.equal(latest.state.status,'ready');controller.dispose();
});

test('late A diff cannot overwrite B even if the underlying read cannot cancel', async () => {
  const page=await read('source-page');let latest;const a=deferred(),b=deferred();let calls=0;
  const controller=createGitController({open:async()=>page,act:()=>++calls===1?a.promise:b.promise,release:async()=>{}},s=>latest=s);
  await controller.open(page.context.workspaceId);
  const initial=latest;
  const pa=controller.act(actionMessage(initial,'open-diff',page.items[0].id));
  const pb=controller.act(actionMessage(initial,'open-diff',page.items[1].id));
  const result=item=>({...page,context:{...page.context,revision:2},detail:{itemId:item.id,path:item.path,staged:item.staged,content:item.path,truncated:false}});
  b.resolve(result(page.items[1]));await pb;a.resolve(result(page.items[0]));await pa;
  assert.equal(latest.view.itemId,page.items[1].id);controller.dispose();
});

test('timed out initial reads surface an error and release leases that arrive later', async () => {
  const request=deferred(),released=[];let latest;
  const controller=createGitController({open:()=>request.promise,act:async()=>{throw Error('unused');},release:async id=>released.push(id)},s=>latest=s,5);
  await controller.open('fixture-workspace');assert.equal(latest.state.status,'error');assert.match(latest.state.message,/timeout/);
  request.resolve(await read('source-page'));await new Promise(resolve=>setTimeout(resolve,0));assert.deepEqual(released,['fixture-generation']);controller.dispose();
});

test('checked-in validator matches the schema and never compiles code under desktop CSP', async () => {
  const {validatorSource}=await import('../scripts/build-semantic-validator.mjs');
  const generated=await readFile('src/lib/presentation/semantic-view-validator.js','utf8');
  assert.equal(generated,await validatorSource());assert.doesNotMatch(generated,/new Function\(|eval\(/);
});

test('another workspace contribution uses the same core view vocabulary', async () => {
  const snapshot=await read('collection');snapshot.context.contributionId='dev.example.changes';snapshot.contribution.id='dev.example.changes';snapshot.contribution.title='另一个工作区工具';assertSnapshot(snapshot);
  snapshot.context.contributionId='dev.other.changes';assert.throws(()=>assertSnapshot(snapshot),/identity/);
});

test('a port response cannot replace the requested workspace or reuse an old revision', async () => {
  const page=await read('source-page');let latest;
  const wrong=createGitController({open:async()=>page,act:async()=>page,release:async()=>{}},s=>latest=s);
  await wrong.open('different-workspace');assert.equal(latest.state.status,'error');assert.match(latest.state.message,/context/);wrong.dispose();
  const stale=createGitController({open:async()=>page,act:async()=>page,release:async()=>{}},s=>latest=s);
  await stale.open(page.context.workspaceId);await stale.act(actionMessage(latest,'open-diff',page.items[0].id));assert.equal(latest.state.status,'error');assert.match(latest.state.message,/context/);stale.dispose();
});
