import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

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

test('slash and mention category bars stay outside their option scrollports', async () => {
  const composer = await readFile('src/lib/components/app/Composer.svelte', 'utf8');
  const scrollports = composer.match(/bind:this=\{suggestionList\} class="composer-suggestion-options" role="listbox"/g) ?? [];
  assert.equal(scrollports.length, 2);
  assert.doesNotMatch(composer, /bind:this=\{suggestionList\} class="composer-suggestions"/);
});
