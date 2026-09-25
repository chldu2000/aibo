import Select from './shared/Select.svelte';
import SessionControlMark from './shared/SessionControlMark.svelte';
import RepositorySelect from './shared/RepositorySelect.svelte';
import AttachmentList from './shared/AttachmentList.svelte';
import ModelContextSelect from './shared/ModelContextSelect.svelte';
import SubagentDialog from './shared/SubagentDialog.svelte';
import SubagentCard from './shared/SubagentCard.svelte';
import GoalBar from './shared/GoalBar.svelte';
import AgentSettingsForm from './shared/AgentSettingsSurface.svelte';
import SettingsSection from './shared/SettingsSection.svelte';
import HostPanel from './shared/HostPanel.svelte';
import ManagementCenter from './shared/ManagementCenter.svelte';
import WorkbenchChrome from './shared/WorkbenchChrome.svelte';
import SemanticView from './shared/SemanticSurface.svelte';
import AlertDialogComponent from './shared/AlertDialog.svelte';
import { Badge as BadgeComponent } from '$lib/components/ui/badge';
import ButtonComponent from './shared/Button.svelte';
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
import ModelMatrixComponent from './shared/ModelMatrix.svelte';
import ColumnSplitterComponent from './shared/ColumnSplitter.svelte';
import FileChangeMark from './shared/FileChangeMark.svelte';
import type { UiKitAdapter } from '../contract';


// Stable component identities preserve drafts, focus, dialogs and menu state.
export const sharedControls: Omit<UiKitAdapter, 'Icon' | 'AgentStatusMark'> = {
  Select,
  FileChangeMark,
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
  AlertDialog: AlertDialogComponent,
  Badge: BadgeComponent,
  Button: ButtonComponent,
  Card: CardComponent,
  CardContent: CardContentComponent,
  CardFooter: CardFooterComponent,
  CardHeader: CardHeaderComponent,
  CardTitle: CardTitleComponent,
  ColumnSplitter: ColumnSplitterComponent,
  Input: InputComponent,
  Label: LabelComponent,
  ModelContextSelect,
  RepositorySelect,
  SessionControlMark,
  ModelMatrix: ModelMatrixComponent,
  Separator: SeparatorComponent,
  Textarea: TextareaComponent,
};
