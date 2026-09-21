import type { SessionControl } from '../../../packages/plugin-protocol/src/session';
export type UiAttachmentListProps = {
 items: { id: string; path: string; mediaType: string }[];
 previews?: Record<string, string | null>;
 onRemove?: (id: string) => void;
 disabled?: boolean;
};
import type { AgentSettingsSnapshot, AgentSettingValue } from '../../../packages/plugin-protocol/src/settings';
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
  | 'check'
  | 'chevron-down'
  | 'close'
  | 'delete'
  | 'diagnostics'
  | 'edit'
  | 'eye'
  | 'shield-question'
  | 'shield-alert'
  | 'filter'
  | 'file'
  | 'focus'
  | 'folder'
  | 'folder-add'
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

export type UiManagementSection = 'appearance' | 'extensions' | 'runtime';
export type UiManagementCenterProps = {
  title: string;
  activeSection: UiManagementSection;
  onSelectSection: (section: UiManagementSection) => void;
  onClose: () => void;
  appearance: Snippet;
  extensions: Snippet;
  runtime: Snippet;
  footer?: Snippet;
};
export type UiWorkbenchChromeProps = {
  layout: string;
  children: Snippet;
};

export type UiAgentSettingsFormProps = {
  snapshot: AgentSettingsSnapshot;
  draft: Record<string, AgentSettingValue>;
  busy: boolean; error: string | null; notice: string | null;
  onChange: (key: string, value: AgentSettingValue | undefined) => void;
  onSave: () => void; onReset: () => void; onReload: () => void;
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
  SubagentCard: Component<UiSubagentCardProps>;
  AttachmentList: Component<UiAttachmentListProps>;
  SubagentDialog: Component<UiSubagentDialogProps>;
  GoalBar: Component<UiGoalBarProps>;
  AgentSettingsForm: Component<UiAgentSettingsFormProps>;
  WorkbenchChrome: Component<UiWorkbenchChromeProps>;
  ManagementCenter: Component<UiManagementCenterProps>;
  SettingsSection: Component<UiSettingsSectionProps>;
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
