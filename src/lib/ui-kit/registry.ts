import { derived, get, writable } from 'svelte/store';
import type { AppearanceSelection, UiKitOption, UiKitRegistration } from './contract';
import { akUiKitRegistration } from './kits/ak-ui';
import { material3UiKitRegistration } from './kits/material3';
import { normalizeDefaultAppearance } from './appearance-selection';
import { themeForColorScheme } from './theme-options';
import { defaultPresentation } from '../workbench/plugins/default-presentation';
import { resolvePresentationPlugin } from './presentation-plugin';

const STORAGE_KEY = 'aibo.appearance.v1';

const builtInDefault = { ...akUiKitRegistration, renderer: defaultPresentation };
const presentationRegistrations = [akUiKitRegistration, material3UiKitRegistration].map(
  ({ adapter, ...metadata }) => resolvePresentationPlugin({ ...metadata, components: adapter }, builtInDefault),
);
// Compatibility projection: existing appearance consumers keep their current interface.
const registrations = presentationRegistrations;

export type UiKitName = 'ak-ui' | 'material3';

const registrationMap = new Map<string, UiKitRegistration>(
  registrations.map((registration) => [registration.id, registration]),
);

function fallbackSelection(): AppearanceSelection {
  const requestedKit = import.meta.env.VITE_AIBO_UI_KIT?.trim();
  const registration = (requestedKit && registrationMap.get(requestedKit)) ?? registrations[0];
  return { kitId: registration.id, themeId: registration.defaultThemeId };
}

function readInitialSelection(): AppearanceSelection {
  if (typeof window === 'undefined') return fallbackSelection();
  try {
    const restored = normalizeDefaultAppearance(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null'), registrations);
    if (restored) persistSelection(restored);
    return restored ?? fallbackSelection();
  } catch {
    return fallbackSelection();
  }
}

function persistSelection(next: AppearanceSelection) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // A restricted WebView may reject localStorage access.
  }
}

const selection = writable<AppearanceSelection>(readInitialSelection());

export const appearanceSelection = { subscribe: selection.subscribe };
export const availableUiKits: readonly UiKitOption[] = registrations.map(({ adapter: _adapter, renderer: _renderer, ...registration }) => registration);
export const activeUiKitName = derived(selection, ($selection) => $selection.kitId as UiKitName);
export const activeUiKitRegistration = derived(selection, ($selection) => registrationMap.get($selection.kitId) ?? registrations[0]);
export const activeUiKit = derived(activeUiKitRegistration, ($registration) => $registration.adapter);
export const activePresentationPlugin = derived(selection, ($selection) =>
  presentationRegistrations.find(plugin => plugin.id === $selection.kitId) ?? presentationRegistrations[0],
);
export const activeTheme = derived(
  [selection, activeUiKitRegistration],
  ([$selection, $registration]) =>
    $registration.themes.find((theme) => theme.id === $selection.themeId) ?? $registration.themes[0],
);
export const activeThemeStyle = derived(activeTheme, ($theme) =>
  Object.entries($theme.tokens)
    .map(([name, value]) => `${name}: ${value}`)
    .join('; '),
);

export function setUiKit(kitId: string) {
  if (kitId === 'shadcn') kitId = 'ak-ui';
  const registration = registrationMap.get(kitId);
  if (!registration) return;
  const current = get(selection);
  const currentScheme = get(activeTheme).colorScheme;
  const themeId = current.kitId === kitId && registration.themes.some((theme) => theme.id === current.themeId)
    ? current.themeId
    : registration.themes.find(theme => theme.colorScheme === currentScheme)?.id ?? registration.defaultThemeId;
  const next = { kitId: registration.id, themeId };
  selection.set(next);
  persistSelection(next);
}

export function setUiTheme(themeId: string) {
  const current = get(selection);
  const registration = registrationMap.get(current.kitId);
  if (!registration?.themes.some((theme) => theme.id === themeId)) return;
  const next = { ...current, themeId };
  selection.set(next);
  persistSelection(next);
}

export function toggleUiColorScheme() {
  const current = get(activeTheme);
  const next = themeForColorScheme(get(activeUiKitRegistration).themes, current.id,
    current.colorScheme === 'light' ? 'dark' : 'light');
  if (next) setUiTheme(next.id);
}
