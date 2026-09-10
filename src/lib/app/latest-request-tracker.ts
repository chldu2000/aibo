export type LatestRequestTracker = {
  begin: (key: string) => number;
  isLatest: (key: string, generation: number) => boolean;
};

export function createLatestRequestTracker(): LatestRequestTracker {
  const generations = new Map<string, number>();

  return {
    begin(key) {
      const generation = (generations.get(key) ?? 0) + 1;
      generations.set(key, generation);
      return generation;
    },
    isLatest(key, generation) {
      return generations.get(key) === generation;
    },
  };
}
