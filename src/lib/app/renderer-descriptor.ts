import { CORE_SEMANTICS, type RendererDescriptor } from '../presentation/renderer-contract.ts';

export function validateRenderer(descriptor: RendererDescriptor): void {
  if (!descriptor || !/^[a-z][a-z0-9.-]{2,127}$/.test(descriptor.id) || !/^\d+\.\d+\.\d+$/.test(descriptor.version) || descriptor.semanticVersion !== '1.0.0') throw Error('incompatible_renderer: identity or version');
  if (!Array.isArray(descriptor.core) || descriptor.core.length !== CORE_SEMANTICS.length || !CORE_SEMANTICS.every(kind => descriptor.core.includes(kind))) throw Error('incompatible_renderer: missing core semantics');
  if (!Array.isArray(descriptor.optional) || descriptor.optional.length > 32) throw Error('incompatible_renderer: optional limit');
  const ids = new Set<string>();
  for (const extension of descriptor.optional) {
    if (!extension || !extension.id.startsWith(descriptor.id + '.') || ids.has(extension.id) || !/^\d+\.\d+\.\d+$/.test(extension.version) || !CORE_SEMANTICS.includes(extension.semantic)) throw Error('incompatible_renderer: optional declaration');
    ids.add(extension.id);
  }
}

