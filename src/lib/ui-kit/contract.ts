import type { Component } from 'svelte';

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
  Input: Component;
  Label: Component;
  Separator: Component;
  Textarea: Component;
};
