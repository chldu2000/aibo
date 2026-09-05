import type { Component } from 'svelte';

export type UiIconName =
  | 'add'
  | 'archive'
  | 'archive-restore'
  | 'branch'
  | 'check'
  | 'chevron-down'
  | 'close'
  | 'delete'
  | 'edit'
  | 'filter'
  | 'folder'
  | 'folder-add'
  | 'refresh'
  | 'search'
  | 'send'
  | 'settings'
  | 'stop'
  | 'terminal'
  | 'trust'
  | 'undo'
  | 'untrust';

/**
 * The minimum visual surface consumed by Aibo's app-level components.
 * Concrete kits may wrap shadcn-svelte, another Svelte library, or local
 * components as long as they keep this component set available. AlertDialog
 * follows the app's semantic props: open/title/description, confirmText,
 * cancelText, onConfirm and onCancel.
 */
export type UiKitAdapter = {
  AlertDialog: Component;
  Badge: Component;
  Button: Component;
  Card: Component;
  CardContent: Component;
  CardFooter: Component;
  CardHeader: Component;
  CardTitle: Component;
  Icon: Component;
  Input: Component;
  Label: Component;
  Separator: Component;
  Textarea: Component;
};

export type UiThemeRegistration = {
  id: string;
  label: string;
  description: string;
  colorScheme: 'dark' | 'light';
  swatches: readonly string[];
  tokens: Readonly<Record<`--${string}`, string>>;
};

export type UiKitRegistration = {
  id: string;
  label: string;
  description: string;
  adapter: UiKitAdapter;
  defaultThemeId: string;
  themes: readonly UiThemeRegistration[];
};

export type AppearanceSelection = {
  kitId: string;
  themeId: string;
};

export type UiKitOption = Omit<UiKitRegistration, 'adapter'>;
