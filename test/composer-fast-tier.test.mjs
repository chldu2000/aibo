import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('Composer resolves Fast from explicit capabilities when selectedSession is a boolean', () => {
  const source = readFileSync(new URL('../src/lib/components/app/Composer.svelte', import.meta.url), 'utf8');
  const body = source.match(/const matrixFastTier = \$derived\.by\(\(\) => \{([\s\S]*?)\n  \}\);/)?.[1];
  assert.ok(body, 'exercise the actual Fast derived expression');
  const resolve = new Function('selectedSession', 'sessionCapabilities', 'modelCatalog', body);
  const tier = { id: 'priority', label: 'Fast', description: '2x speed' };
  const catalog = { current: { serviceTiers: [tier] }, currentServiceTier: 'priority' };
  assert.deepEqual(resolve(true, ['model.service-tier'], catalog), { ...tier, active: true });
  assert.equal(resolve(true, [], catalog), null);
  assert.equal(resolve(false, [], null), null);
});
