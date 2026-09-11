import type { RendererDescriptor } from '../../presentation/renderer-contract';
import { validateRenderer } from '../../app/renderer-descriptor';

/** This module is imported by the host build; installed capability packages cannot register code here. */
export const defaultPresentation = {
  id: 'dev.aibo.ui-default',
  version: '1.0.0',
  semanticVersion: '1.0.0',
  core: ['collection', 'detail', 'settings', 'inspector'],
  optional: [],
} as const satisfies RendererDescriptor;

export const defaultLayouts = ['standard', 'focus'] as const;
export type DefaultLayout = typeof defaultLayouts[number];
export function preflightDefaultPresentation(layout: string): asserts layout is DefaultLayout {
  validateRenderer(defaultPresentation);
  if (!defaultLayouts.some(candidate => candidate === layout)) throw Error('incompatible_renderer: unknown layout');
}
