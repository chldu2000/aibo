import { derived, get, writable } from 'svelte/store';
import type { AppearanceSelection, UiKitOption, UiKitRegistration } from './contract';
import { material3UiKitRegistration } from './kits/material3';
import { shadcnUiKitRegistration } from './kits/shadcn';

const STORAGE_KEY = 'aibo.appearance.v1';

const registrations = [shadcnUiKitRegistration, material3UiKitRegistration] as const;

export type UiKitName = 'shadcn' | 'material3';

const registrationMap = new Map<string, UiKitRegistration>(
  registrations.map((registration) => [registration.id, registration]),
);

function fallbackSelection(): AppearanceSelection {
  const requestedKit = import.meta.env.VITE_AIBO_UI_KIT?.trim();
  const registration = (requestedKit && registrationMap.get(requestedKit)) ?? registrations[0];
  return { kitId: registration.id, themeId: registration.defaultThemeId };
}

function normalizeSelection(value: unknown): AppearanceSelection | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<AppearanceSelection>;
  if (typeof candidate.kitId !== 'string' || typeof candidate.themeId !== 'string') return null;
  const registration = registrationMap.get(candidate.kitId);
  if (!registration?.themes.some((theme) => theme.id === candidate.themeId)) return null;
  return { kitId: candidate.kitId, themeId: candidate.themeId };
}

function readInitialSelection(): AppearanceSelection {
  if (typeof window === 'undefined') return fallbackSelection();
  try {
    return normalizeSelection(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null')) ?? fallbackSelection();
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
export const availableUiKits: readonly UiKitOption[] = registrations.map(({ adapter: _adapter, ...registration }) => registration);
export const activeUiKitName = derived(selection, ($selection) => $selection.kitId as UiKitName);
export const activeUiKitRegistration = derived(selection, ($selection) => registrationMap.get($selection.kitId) ?? registrations[0]);
export const activeUiKit = derived(activeUiKitRegistration, ($registration) => $registration.adapter);
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
  const registration = registrationMap.get(kitId);
  if (!registration) return;
  const current = get(selection);
  const themeId = current.kitId === kitId && registration.themes.some((theme) => theme.id === current.themeId)
    ? current.themeId
    : registration.defaultThemeId;
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
