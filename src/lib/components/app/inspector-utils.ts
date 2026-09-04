import type { PiSessionTreeNode } from '$lib/types';

export function flattenPiTree(nodes: PiSessionTreeNode[], depth = 0): Array<{ node: PiSessionTreeNode; depth: number }> {
  return nodes.flatMap((node) => [
    { node, depth },
    ...flattenPiTree(node.children ?? [], depth + 1),
  ]);
}
