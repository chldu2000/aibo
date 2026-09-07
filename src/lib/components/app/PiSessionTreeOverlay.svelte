<script lang="ts">
  import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Icon } from '$lib/ui-kit';
  import type { PiSessionTreeNode, PiSessionTreeSnapshot } from '$lib/types';
  import type { SessionPanelView } from './view-types';

  type GraphNode = { node: PiSessionTreeNode; x: number; y: number };
  type GraphEdge = { id: string; fromX: number; fromY: number; toX: number; toY: number };

  type PiSessionTreeOverlayProps = {
    open: boolean;
    session: SessionPanelView | null;
    tree: PiSessionTreeSnapshot | null;
    busy: boolean;
    sessionRunning: boolean;
    selectedSessionArchiving: boolean;
    navigationStatus: string | null;
    onClose: () => void;
    onRefresh: (sessionId: string) => void;
    onSelectNode: (entryId: string) => void;
  };

  let {
    open,
    session,
    tree,
    busy,
    sessionRunning,
    selectedSessionArchiving,
    navigationStatus,
    onClose,
    onRefresh,
    onSelectNode,
  }: PiSessionTreeOverlayProps = $props();

  const nodeWidth = 156;
  const nodeHeight = 58;
  const columnGap = 42;
  const rowGap = 54;

  const graph = $derived.by(() => {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    let nextLeaf = 0;
    let maxDepth = 0;

    function visit(node: PiSessionTreeNode, depth: number): number {
      maxDepth = Math.max(maxDepth, depth);
      const childPositions = node.children.map((child) => ({ child, x: visit(child, depth + 1) }));
      const x = childPositions.length > 0
        ? childPositions.reduce((sum, child) => sum + child.x, 0) / childPositions.length
        : nextLeaf++ * (nodeWidth + columnGap);
      const y = depth * (nodeHeight + rowGap);
      nodes.push({ node, x, y });
      for (const child of childPositions) {
        edges.push({
          id: `${node.id}-${child.child.id}`,
          fromX: x + nodeWidth / 2,
          fromY: y + nodeHeight,
          toX: child.x + nodeWidth / 2,
          toY: y + nodeHeight + rowGap,
        });
      }
      return x;
    }

    for (const root of tree?.tree ?? []) visit(root, 0);
    return {
      nodes,
      edges,
      width: Math.max(680, nextLeaf * (nodeWidth + columnGap) - columnGap),
      height: Math.max(260, (maxDepth + 1) * nodeHeight + maxDepth * rowGap),
    };
  });

  function handleWindowKeydown(event: KeyboardEvent): void {
    if (open && !navigationStatus && event.key === 'Escape') onClose();
  }

  function requestClose(): void {
    if (!navigationStatus) onClose();
  }
</script>

<svelte:window onkeydown={handleWindowKeydown} />

{#if open && session?.agent === 'pi'}
  <div class="pi-tree-overlay" role="presentation" onclick={requestClose}>
    <Card class="pi-tree-dialog" role="dialog" aria-modal="true" aria-labelledby="pi-tree-title" onclick={(event) => event.stopPropagation()}>
      <CardHeader class="pi-tree-dialog-header">
        <div class="pi-tree-dialog-title">
          <CardTitle id="pi-tree-title">Pi 会话树</CardTitle>
          <small>{session.label}</small>
        </div>
        <div class="pi-tree-dialog-actions">
          <Badge variant="secondary">{graph.nodes.length} 个节点</Badge>
          <Button variant="ghost" size="sm" type="button" onclick={() => onRefresh(session.id)} disabled={busy || selectedSessionArchiving}>
            <Icon name="refresh" size={13} /> 刷新
          </Button>
          <Button variant="ghost" size="icon" type="button" aria-label="关闭会话树" title="关闭" onclick={requestClose} disabled={Boolean(navigationStatus)}>
            <Icon name="close" size={14} />
          </Button>
        </div>
      </CardHeader>
      <CardContent class="pi-tree-dialog-content">
        {#if navigationStatus}
          <div class="pi-tree-navigation-status" role="status" aria-live="assertive">
            <span class="activity-dots" aria-hidden="true"><span></span><span></span><span></span></span>
            <strong>{navigationStatus}</strong>
            <small>总结耗时取决于当前分支长度，请稍候。</small>
          </div>
        {/if}
        {#if !tree}
          <div class="pi-tree-empty">正在读取会话树…</div>
        {:else if graph.nodes.length === 0}
          <div class="pi-tree-empty">发送第一条消息后，这里会显示可切换的会话节点。</div>
        {:else}
          <div class="pi-tree-viewport">
            <div class="pi-tree-canvas" style={`width: ${graph.width}px; height: ${graph.height}px`}>
              <svg class="pi-tree-edges" width={graph.width} height={graph.height} aria-hidden="true">
                {#each graph.edges as edge (edge.id)}
                  <path d={`M ${edge.fromX} ${edge.fromY} C ${edge.fromX} ${edge.fromY + rowGap / 2}, ${edge.toX} ${edge.toY - rowGap / 2}, ${edge.toX} ${edge.toY}`} />
                {/each}
              </svg>
              {#each graph.nodes as entry (entry.node.id)}
                {@const current = entry.node.id === tree.leafId}
                <Button
                  variant={current ? 'secondary' : 'outline'}
                  class={current ? 'pi-tree-node current' : 'pi-tree-node'}
                  type="button"
                  style={`left: ${entry.x}px; top: ${entry.y}px; width: ${nodeWidth}px; height: ${nodeHeight}px`}
                  aria-label={`${entry.node.label ?? entry.node.summary ?? entry.node.type}${current ? '，当前节点' : '，切换到此节点'}`}
                  aria-current={current ? 'true' : undefined}
                  onclick={() => !current && onSelectNode(entry.node.id)}
                  disabled={current || busy || sessionRunning || selectedSessionArchiving || Boolean(navigationStatus)}
                >
                  <span class="pi-tree-node-marker" aria-hidden="true"></span>
                  <span class="pi-tree-node-copy">
                    <strong>{entry.node.label ?? entry.node.summary ?? entry.node.type}</strong>
                    <small>{current ? '当前节点' : entry.node.role ?? entry.node.type}</small>
                  </span>
                </Button>
              {/each}
            </div>
          </div>
        {/if}
      </CardContent>
    </Card>
  </div>
{/if}
