// Reuse existing semantic controls and their behavior; the ak-ui skin owns all appearance.
import SessionControlMark from './shared/SessionControlMark.svelte';
import RepositorySelect from './shared/RepositorySelect.svelte';
import AttachmentList from './shared/AttachmentList.svelte';
import ModelContextSelect from './shadcn/ModelContextSelect.svelte';
import SubagentDialog from './shadcn/SubagentDialog.svelte';
import SubagentCard from './shadcn/SubagentCard.svelte';
import GoalBar from './shadcn/GoalBar.svelte';
import AgentSettingsForm from './shadcn/AgentSettingsForm.svelte';
import SettingsSection from './shadcn/SettingsSection.svelte';
import HostPanel from './shared/HostPanel.svelte';
import ManagementCenter from './ak-ui/ManagementCenter.svelte';
import WorkbenchChrome from './ak-ui/WorkbenchChrome.svelte';
import SemanticView from './shadcn/SemanticView.svelte';
import AlertDialogComponent from './ak-ui/AlertDialog.svelte';
import { Badge as BadgeComponent } from '$lib/components/ui/badge';
import ButtonComponent from './ak-ui/Button.svelte';
import {
  Card as CardComponent,
  CardContent as CardContentComponent,
  CardFooter as CardFooterComponent,
  CardHeader as CardHeaderComponent,
  CardTitle as CardTitleComponent,
} from '$lib/components/ui/card';
import { Input as InputComponent } from '$lib/components/ui/input';
import { Label as LabelComponent } from '$lib/components/ui/label';
import { Separator as SeparatorComponent } from '$lib/components/ui/separator';
import { Textarea as TextareaComponent } from '$lib/components/ui/textarea';
import IconComponent from './ak-ui/Icon.svelte';
import ModelMatrixComponent from './shadcn/ModelMatrix.svelte';
import ColumnSplitterComponent from './shadcn/ColumnSplitter.svelte';
import AgentStatusMarkComponent from './ak-ui/AgentStatusMark.svelte';
import type { UiKitAdapter, UiKitRegistration, UiThemeRegistration } from '../contract';

import metadata from './ak-ui/themes.json';

export const akUiKit: UiKitAdapter = {
  SubagentDialog,
  SubagentCard,
  AttachmentList,
  GoalBar,
  HostPanel,
  ManagementCenter,
  WorkbenchChrome,
  SettingsSection,
  AgentSettingsForm,
  SemanticView,
  AgentStatusMark: AgentStatusMarkComponent,
  AlertDialog: AlertDialogComponent,
  Badge: BadgeComponent,
  Button: ButtonComponent,
  Card: CardComponent,
  CardContent: CardContentComponent,
  CardFooter: CardFooterComponent,
  CardHeader: CardHeaderComponent,
  CardTitle: CardTitleComponent,
  ColumnSplitter: ColumnSplitterComponent,
  Icon: IconComponent,
  Input: InputComponent,
  Label: LabelComponent,
  ModelContextSelect,
  RepositorySelect,
  SessionControlMark,
  ModelMatrix: ModelMatrixComponent,
  Separator: SeparatorComponent,
  Textarea: TextareaComponent,
};

export const akUiKitRegistration: UiKitRegistration = {...metadata, themes: metadata.themes as UiThemeRegistration[], adapter: akUiKit};
