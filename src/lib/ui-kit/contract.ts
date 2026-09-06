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
  | 'diagnostics'
  | 'edit'
  | 'filter'
  | 'file'
  | 'folder'
  | 'folder-add'
  | 'panel-right'
  | 'refresh'
  | 'review'
  | 'search'
  | 'send'
  | 'settings'
  | 'stop'
  | 'terminal'
  | 'trust'
  | 'undo'
  | 'untrust';

/**
 * Semantic button intents exposed to page components.
 *
 * The application chooses what an action means; each UI kit chooses how that
 * intent is rendered (shape, color, state layer, typography, and elevation).
 */
export type UiButtonVariant =
  | 'default'
  | 'secondary'
  | 'destructive'
  | 'outline'
  | 'ghost'
  | 'link'
  | 'toolbar'
  | 'queue'
  | 'abort'
  | 'send';

export type UiModelMatrixCell = {
  id: string;
  label: string;
  description: string | null;
  available: boolean;
  active: boolean;
};

export type UiModelMatrixColumn = Pick<UiModelMatrixCell, 'id' | 'label' | 'description'>;

export type UiModelMatrixRow = {
  reference: string;
  label: string;
  isDefault: boolean;
  active: boolean;
  defaultActive: boolean;
  cells: readonly UiModelMatrixCell[];
};

export type UiModelMatrixProps = {
  columns: readonly UiModelMatrixColumn[];
  rows: readonly UiModelMatrixRow[];
  defaultLabel: string;
  defaultTitle: string;
  disabled: boolean;
  onSelect: (model: string, reasoningEffort: string | null) => void | Promise<void>;
};

export type UiColumnSplitterProps = {
  label: string;
  width: number;
  onPointerDown: (event: PointerEvent) => void;
  onKeyDown: (event: KeyboardEvent) => void;
};

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
  ColumnSplitter: Component<UiColumnSplitterProps>;
  Icon: Component;
  Input: Component;
  Label: Component;
  ModelMatrix: Component<UiModelMatrixProps>;
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
