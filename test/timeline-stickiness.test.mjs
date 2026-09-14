import assert from 'node:assert/strict';
import test from 'node:test';

import { createTimelineStickiness } from '../src/lib/app/timeline-stickiness.ts';

test('timeline follows new content until the user leaves the bottom', () => {
  const sticky = createTimelineStickiness();
  assert.equal(sticky.shouldStick(), true, 'new and reset timelines start pinned');

  sticky.updateFromScroll({ scrollTop: 768, clientHeight: 200, scrollHeight: 1000 });
  assert.equal(sticky.shouldStick(), true, 'near-bottom rounding stays pinned');

  sticky.updateFromScroll({ scrollTop: 500, clientHeight: 200, scrollHeight: 1000 });
  assert.equal(sticky.shouldStick(), false, 'manual upward navigation pauses following');
});

test('returning to the bottom resumes following streaming growth', () => {
  const sticky = createTimelineStickiness();
  sticky.updateFromScroll({ scrollTop: 300, clientHeight: 200, scrollHeight: 1000 });
  assert.equal(sticky.shouldStick(), false);

  sticky.updateFromScroll({ scrollTop: 800, clientHeight: 200, scrollHeight: 1000 });
  assert.equal(sticky.shouldStick(), true);
  const grownViewport = { scrollTop: 800, clientHeight: 200, scrollHeight: 1200 };
  assert.equal(sticky.scrollToBottom(grownViewport), true);
  assert.equal(grownViewport.scrollTop, 1200, 'streaming growth is immediately brought into view');

  sticky.updateFromScroll({ scrollTop: 100, clientHeight: 200, scrollHeight: 1000 });
  const pausedViewport = { scrollTop: 100, clientHeight: 200, scrollHeight: 1200 };
  assert.equal(sticky.scrollToBottom(pausedViewport), false);
  assert.equal(pausedViewport.scrollTop, 100, 'content growth does not move a manually scrolled viewport');
  sticky.reset();
  assert.equal(sticky.shouldStick(), true, 'switching conversations starts at latest content');
});
