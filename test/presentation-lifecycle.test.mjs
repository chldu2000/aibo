import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
const view = JSON.parse(await readFile(new URL('../fixtures/semantic-git/collection.json', import.meta.url), 'utf8'));
const recovery = { selection: null, detail: null, focus: 'entry' };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('renderer switch restores the latest snapshot, disposes subscriptions and rejects old channels', async () => {
  const server = await createServer({ server: { middlewareMode: true, ws: false, watch: null }, appType: 'custom' });
  try {
    const { createPresentationController } = await server.ssrLoadModule('/src/lib/app/presentation-controller.ts');
    const instances = [], errors = [], actions = [];
    let subscriptions = 0;
    const renderer = {
      async preflight() {},
      async mount(snapshot, dispatch) {
        subscriptions++;
        const instance = { snapshot, dispatch, update(value) { this.snapshot = value; }, async dispose() { subscriptions--; } };
        instances.push(instance); return instance;
      },
    };
    const host = createPresentationController({ view, recovery, fallback: renderer, onAction: action => actions.push(action), onError: error => errors.push(error) });
    await host.switchRenderer(renderer);
    const first = instances[0];
    const message = instance => ({ schema: 'aibo.presentation-action/experimental-v1', generation: instance.snapshot.generation, action: { context: instance.snapshot.view.context, actionId: 'refresh', itemId: null } });
    assert.equal(first.dispatch(message(first)), true);
    // Preflight failure preserves the original working channel.
    await host.switchRenderer({ ...renderer, async preflight() { throw new Error('unsupported'); } });
    assert.equal(first.dispatch(message(first)), true);
    const entered = deferred(), ready = deferred();
    const switchPromise = host.switchRenderer({ ...renderer, async mount(...args) { entered.resolve(); await ready.promise; return renderer.mount(...args); } });
    await entered.promise;
    assert.equal(subscriptions, 0);
    const next = structuredClone(view); next.context.revision++;
    host.update(next, { ...recovery, focus: 'new-focus' });
    ready.resolve(); await switchPromise;
    assert.equal(subscriptions, 1);
    assert.equal(instances[1].snapshot.view.context.revision, next.context.revision);
    assert.equal(instances[1].snapshot.recovery.focus, 'new-focus');
    assert.equal(first.dispatch(message(first)), false);
    assert.equal(first.dispatch(message(instances[1])), false, 'old renderer cannot forge the new generation');
    const wrong = message(instances[1]); wrong.action.context = { ...wrong.action.context, workspaceId: 'other' };
    assert.equal(instances[1].dispatch(wrong), false);
    await host.switchRenderer({ ...renderer, async mount() { throw new Error('broken mount'); } });
    assert.equal(subscriptions, 1, 'fallback has exactly one subscription');
    assert.equal(instances.at(-1).snapshot.recovery.focus, 'new-focus');
    assert.equal(actions.length, 2);
    await host.dispose();
    assert.equal(subscriptions, 0);
    assert.equal(instances.at(-1).dispatch(message(instances.at(-1))), false);
    assert.equal(errors.length, 2);
  } finally { await server.close(); }
});

test('timed out mounts are disposed when they arrive and cannot replace the fallback', async () => {
  const server = await createServer({ server: { middlewareMode: true, ws: false, watch: null }, appType: 'custom' });
  try {
    const { createPresentationController } = await server.ssrLoadModule('/src/lib/app/presentation-controller.ts');
    const ready = deferred(); let active, cleaned = 0, fallbackMounts = 0;
    const fallback = { async preflight() {}, async mount() { fallbackMounts++; return { update() {}, async dispose() {} }; } };
    const host = createPresentationController({ view, recovery, fallback, timeoutMs: 10, onAction() {}, onError() {} });
    await host.switchRenderer({ async preflight() {}, async mount(_snapshot, _dispatch, isActive) { active = isActive; await ready.promise; return { update() {}, async dispose() { cleaned++; } }; } });
    assert.equal(fallbackMounts, 1); assert.equal(active(), false);
    ready.resolve(); await new Promise(done => setImmediate(done));
    assert.equal(cleaned, 1);
    await host.dispose();
  } finally { await server.close(); }
});
