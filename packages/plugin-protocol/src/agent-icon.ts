/** Monochrome SVG path in a 24 × 24 viewBox. No markup, URLs or styling. */
export type AgentIcon = { path: string };

export function readAgentIcon(value: unknown): AgentIcon | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const icon = value as Record<string, unknown>;
  if (Object.keys(icon).length !== 1 || typeof icon.path !== 'string') return undefined;
  if (icon.path.length > 8192 || !/^[Mm][0-9MmZzLlHhVvCcSsQqTtAaEe.,+\s-]+$/.test(icon.path)) return undefined;
  return { path: icon.path };
}
