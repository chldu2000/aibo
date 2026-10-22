import type { SessionControl } from '../../../packages/plugin-protocol/src/session';
export type UiAttachmentListProps = {
 items: { id: string; path: string; mediaType: string; displayName?: string; sizeLabel?: string }[];
 previews?: Record<string, string | null>;
 onRemove?: (id: string) => void;
 onOpen?: (id: string) => void;
 disabled?: boolean;
};
import type { AgentSettingsSnapshot, AgentSettingValue } from '../../../packages/plugin-protocol/src/settings';
import type { ManagementData } from '../../../packages/plugin-protocol/src/management';
import type { PresentationProps } from './presentation-props';
import type { Component, Snippet } from 'svelte';
import type { PresentationModelMatrix, PresentationStatusMark } from '../../../packages/plugin-protocol/src/presentation-controls';
export type {
  PresentationModelCell as UiModelMatrixCell,
  PresentationModelColumn as UiModelMatrixColumn,
  PresentationModelRow as UiModelMatrixRow,
} from '../../../packages/plugin-protocol/src/presentation-controls';

export type UiIconName =
  | 'add'
  | 'archive'
  | 'archive-restore'
  | 'branch'
  | 'bolt'
  | 'terminal'
  | 'check'
  | 'info'
  | 'warning'
  | 'error'
  | 'chevron-down'
  | 'chevron-up'
  | 'close'
  | 'delete'
  | 'diagnostics'
  | 'download'
  | 'edit'
  | 'eye'
  | 'image'
  | 'more'
  | 'moon'
  | 'sun'
  | 'shield-question'
  | 'shield-alert'
  | 'filter'
  | 'file'
  | 'globe'
  | 'mail'
  | 'focus'
  | 'target'
  | 'folder'
  | 'folder-add'
  | 'panel-left'
  | 'panel-right'
  | 'plugins'
  | 'refresh'
  | 'review'
  | 'search'
  | 'send'
  | 'settings'
  | 'pause'
  | 'play'
  | 'stop'
  | 'trust'
  | 'undo'
  | 'untrust'
  | 'window-maximize'
  | 'window-minimize';

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

export type UiSessionControlMarkProps = {
  control: Pick<SessionControl, 'kind' | 'profile'>;
  compact?: boolean;
};

export type UiRepositorySelectProps = {
  repositories: readonly { id: string; name: string; relativePath: string }[];
  selectedId: string | null;
  open: boolean;
  search: string;
  disabled: boolean;
  onOpenChange: (open: boolean) => void;
  onSearch: (value: string) => void;
  onSelect: (id: string | null) => void;
};

export type UiSelectProps = {
  options: readonly { value: string; label: string; disabled?: boolean }[];
  value: string;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  class?: string;
  title?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  onSelect: (value: string) => void;
};

/** A host-drawn listbox anchored to a trigger the host does not render (an isolated control frame). */
export type UiSelectMenuProps = {
  anchor: Pick<DOMRect, 'top' | 'left' | 'bottom' | 'width'>;
  options: readonly { value: string; label: string; disabled?: boolean }[];
  value: string;
  label: string;
  onSelect: (value: string) => void;
  /** Called once when the menu closes for any reason, including after a selection. */
  onClose: () => void;
};

export type UiModelContextSelectProps = {
  options: readonly { id: string; label: string; description: string | null; tokens?: number | null }[];
  current: string | null;
  disabled: boolean;
  onSelect: (id: string) => void | Promise<void>;
};

export type UiModelMatrixProps = PresentationModelMatrix & {
  onSelect: (model: string, reasoningEffort: string | null) => void | Promise<void>;
  onSelectServiceTier: (serviceTier: string) => void | Promise<void>;
};

export type UiColumnSplitterProps = {
  label: string;
  width: number;
  onPointerDown: (event: PointerEvent) => void;
  onKeyDown: (event: KeyboardEvent) => void;
};

export type UiAgentStatusMarkProps = PresentationStatusMark;

export type UiFileChangeMarkProps = {
  kind: 'added' | 'modified' | 'deleted' | 'renamed' | 'conflicted';
  decorative?: boolean;
};

/**
 * The minimum visual surface consumed by Aibo's app-level components.
 * Concrete kits may wrap shadcn-svelte, another Svelte library, or local
 * components as long as they keep this component set available. AlertDialog
 * follows the app's semantic props: open/title/description, confirmText,
 * cancelText, onConfirm and onCancel.
 */
export type UiSettingsAction = {
  id: string;
  label: string;
  intent: 'install' | 'restore' | 'navigate' | 'toggle' | 'remove' | 'layout';
  disabled?: boolean;
  ariaLabel?: string;
  keyShortcuts?: string;
};
export type UiSettingsItem = {
  id: string;
  title: string;
  description?: string;
  icon?: UiIconName;
  shortcut?: string;
  actions: readonly UiSettingsAction[];
};
export type UiSettingsSectionProps = {
  title: string;
  description?: string;
  items: readonly UiSettingsItem[];
  error?: string | null;
  onAction: (itemId: string, actionId: string) => void;
};

export type UiHostPanelProps = {
  title: string;
  backLabel?: string;
  onBack?: () => void;
  onClose: () => void;
  children: Snippet;
  actions?: Snippet;
};

export type UiManagementSection = 'appearance' | 'layout' | 'workspace' | 'extensions' | 'runtime' | `plugin:${string}`;
export type UiManagementCenterProps = {
  title: string;
  /** A changed presentation restores its own semantic focus after the dialog closes. */
  restoreTriggerFocus?: boolean;
  activeSection: UiManagementSection;
  onSelectSection: (section: UiManagementSection) => void;
  onClose: () => void;
  appearance: Snippet;
  layout: Snippet;
  workspace: Snippet;
  extensions: Snippet;
  runtime: Snippet;
  pluginPanels?: readonly { id: `plugin:${string}`; label: string; description: string }[];
  pluginPanel?: Snippet;
  footer?: Snippet;
};
export type UiWorkbenchChromeProps = {
  layout: string;
  /** Visibility from the host layout; skins may recompose slots on narrow screens. */
  auxiliaryOpen?: boolean;
  children: Snippet;
};

export type UiAgentSettingsFormProps = {
  snapshot: AgentSettingsSnapshot;
  draft: Record<string, AgentSettingValue>;
  busy: boolean; error: string | null; notice: string | null;
  onChange: (key: string, value: AgentSettingValue | undefined) => void;
  onSave: () => void; onReset: () => void; onReload: () => void;
};

/** Section tabs inside one page. Tab ids are `${idPrefix}-tab-${id}`; the consumer renders
 * the panel with id `${idPrefix}-panel` and labels it by the selected tab. */
export type UiTabsProps = {
  label: string;
  idPrefix: string;
  items: readonly { id: string; label: string }[];
  value: string;
  onSelect: (id: string) => void;
};

/** Mutually exclusive choice among a few visible options (scope, mode, language). */
export type UiSegmentedControlProps = {
  label: string;
  name: string;
  /** An option that cannot be chosen in this context; shown as unavailable. */
  options: readonly { value: string; label: string; disabled?: boolean }[];
  value: string;
  /** Temporarily blocks the whole group (for example while a change applies) without marking options unavailable. */
  disabled?: boolean;
  onSelect: (value: string) => void;
};

/** Read-only plugin management data. Section actions such as refresh stay in the owner's heading. */
export type UiManagementDataViewProps = {
  status: 'loading' | 'ready' | 'failed' | 'disabled';
  data: ManagementData | null;
  /** The owner already shows this title; a target with the same label is not repeated. */
  ownerTitle?: string;
};

export type UiGoalBarProps = {
  objective: string;
  statusLabel: string;
  usageLabel?: string | null;
  busy?: boolean;
  onClear?: () => void;
  onPause?: () => void;
  onResume?: () => void;
};

export type UiSubagentCardProps = {
  name: string; task: string; statusLabel: string; activity: string;
  failed: boolean; onOpen: () => void;
};
export type UiSubagentDialogProps = {
  open: boolean; title: string; task: string; statusLabel: string;
  onClose: () => void; children?: Snippet;
};

/** Visual adapters render host-projected Agent actions. Feature availability comes
 * from negotiated session capabilities, navigation canSyncSnapshot, and host-owned
 * executionProfile.sessionControls; Agent names select branding only. */
export type UiKitAdapter = {
  Select: Component<UiSelectProps>;
  SelectMenu: Component<UiSelectMenuProps>;
  FileChangeMark: Component<UiFileChangeMarkProps>;
  SubagentCard: Component<UiSubagentCardProps>;
  AttachmentList: Component<UiAttachmentListProps>;
  SubagentDialog: Component<UiSubagentDialogProps>;
  GoalBar: Component<UiGoalBarProps>;
  AgentSettingsForm: Component<UiAgentSettingsFormProps>;
  WorkbenchChrome: Component<UiWorkbenchChromeProps>;
  ManagementCenter: Component<UiManagementCenterProps>;
  SettingsSection: Component<UiSettingsSectionProps>;
  Tabs: Component<UiTabsProps>;
  SegmentedControl: Component<UiSegmentedControlProps>;
  ManagementDataView: Component<UiManagementDataViewProps>;
  HostPanel: Component<UiHostPanelProps>;
  SemanticView: Component<PresentationProps>;
  AgentStatusMark: Component<UiAgentStatusMarkProps>;
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
  ModelContextSelect: Component<UiModelContextSelectProps>;
  RepositorySelect: Component<UiRepositorySelectProps>;
  SessionControlMark: Component<UiSessionControlMarkProps>;
  Separator: Component;
  Textarea: Component;
};

export type UiThemeRegistration = {
  id: string;
  label: string;
  description: string;
  colorScheme: 'dark' | 'light';
  /** Explicit pairing within this kit; absent for the legacy flat theme picker. */
  palette?: { id: string; label: string; description: string };
  swatches: readonly string[];
  tokens: Readonly<Record<`--${string}`, string>>;
};

export type UiKitRegistration = {
  id: string;
  /** Preinstalled Presentation release identity; selection is persisted against this release. */
  packageId?: string;
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
