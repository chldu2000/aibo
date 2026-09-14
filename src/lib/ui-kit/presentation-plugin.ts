import type { UiKitAdapter, UiKitRegistration, UiThemeRegistration } from './contract';
import type { RendererDescriptor } from '../presentation/renderer-contract';
import { validateRenderer } from '../app/renderer-descriptor.ts';

/** Trusted local definition, not an installable manifest or a wire protocol. */
export type PresentationPluginDefinition = {
  id: string;
  label: string;
  description: string;
  themes?: readonly UiThemeRegistration[];
  defaultThemeId?: string;
  components?: Partial<UiKitAdapter>;
  renderer?: RendererDescriptor;
};

export type ResolvedPresentationPlugin = UiKitRegistration & {
  renderer: RendererDescriptor;
};

/** Resolve omissions once so consumers always receive the complete visual contract. */
export function resolvePresentationPlugin(
  definition: PresentationPluginDefinition,
  defaults: ResolvedPresentationPlugin,
): ResolvedPresentationPlugin {
  const themes = definition.themes ?? defaults.themes;
  const defaultThemeId = definition.defaultThemeId ?? (definition.themes ? themes[0]?.id : defaults.defaultThemeId);
  if (!definition.id.trim() || !defaultThemeId || !themes.length || !themes.some(theme => theme.id === defaultThemeId)
    || new Set(themes.map(theme => theme.id)).size !== themes.length) {
    throw Error('invalid_presentation_plugin: invalid identity or themes');
  }
  const adapter = { ...defaults.adapter };
  for (const key of Object.keys(defaults.adapter) as (keyof UiKitAdapter)[]) {
    const component = definition.components?.[key];
    if (component !== undefined) Object.assign(adapter, { [key]: component });
  }
  const renderer = definition.renderer ?? defaults.renderer;
  validateRenderer(renderer);
  return { id: definition.id, label: definition.label, description: definition.description,
    themes, defaultThemeId, adapter, renderer };
}
