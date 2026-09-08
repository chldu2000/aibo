/** Host-validated Plugin View v1 input; never spread plugin properties onto DOM. */
export type UiPluginViewNode = {
  id: string;
  type: string;
  props: Record<string, unknown>;
  children: UiPluginViewNode[];
};

export type UiPluginViewDocument = {
  schema: 'aibo.plugin-view/v1';
  viewId: string;
  revision: number;
  title: string;
  data: Record<string, unknown>;
  bindings: { nodeId: string; property: string; dataPath: string }[];
  actions: { id: string; capability: string; inputSchema: Record<string, unknown>; confirmation: string; operationId?: string }[];
  resources: string[];
  root: UiPluginViewNode;
};

export type UiPluginViewInteraction = {
  fields: Record<string, string | number | boolean | null>;
  expanded: Record<string, boolean>;
};

export type UiPluginViewProps = {
  document: UiPluginViewDocument;
  sessionId?: string;
  disabled?: boolean;
  onAction: (actionId: string, input: Record<string, unknown>) => void | Promise<void>;
  /** Owned by the runtime proxy, outside replaceable skin components. */
  interaction?: UiPluginViewInteraction;
};

/** JSON Pointer reads are own-property-only; prototype names never resolve. */
export function pluginViewProps(document: UiPluginViewDocument, node: UiPluginViewNode): Record<string, unknown> {
  const result = { ...node.props };
  const allowed = new Set(['text', 'markdown', 'label', 'tone', 'content', 'value', 'disabled', 'selectedId']);
  for (const binding of document.bindings) {
    if (binding.nodeId !== node.id || !allowed.has(binding.property)) continue;
    let value: unknown = document.data;
    for (const part of binding.dataPath.slice(1).split('/')) {
      const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
      if (['__proto__', 'prototype', 'constructor'].includes(key) || !value || typeof value !== 'object' || !Object.hasOwn(value, key)) {
        value = undefined;
        break;
      }
      value = (value as Record<string, unknown>)[key];
    }
    if (value !== undefined) result[binding.property] = value;
  }
  return result;
}
