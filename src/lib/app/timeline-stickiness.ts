export type TimelineViewport = {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
};

export function createTimelineStickiness(_threshold = 32) {
  let pinned = true;
  return {
    updateFromScroll(viewport: TimelineViewport): void {
      const distanceFromBottom = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop;
      pinned = distanceFromBottom <= _threshold;
    },
    shouldStick(): boolean { return pinned; },
    scrollToBottom(viewport: TimelineViewport): boolean {
      if (!pinned) return false;
      viewport.scrollTop = viewport.scrollHeight;
      return true;
    },
    reset(): void { pinned = true; },
  };
}
