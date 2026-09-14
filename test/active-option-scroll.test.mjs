import assert from 'node:assert/strict';
import test from 'node:test';

import { scrollActiveOptionIntoView } from '../src/lib/components/app/active-option-scroll.ts';

test('keyboard navigation keeps the active option within the scroll viewport', () => {
  const calls = [];
  const activeOption = {
    scrollIntoView(options) {
      calls.push(options);
    },
  };
  const container = {
    querySelector(selector) {
      assert.equal(selector, '[role="option"][aria-selected="true"]');
      return activeOption;
    },
  };

  scrollActiveOptionIntoView(container);

  assert.deepEqual(calls, [{ block: 'nearest' }]);
});

test('scrolling is harmless while the suggestion panel is closed', () => {
  assert.doesNotThrow(() => scrollActiveOptionIntoView(null));
});
