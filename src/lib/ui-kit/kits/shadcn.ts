import SettingsSection from './shadcn/SettingsSection.svelte';
import HostPanel from './shared/HostPanel.svelte';
import ManagementCenter from './shadcn/ManagementCenter.svelte';
import SemanticView from './shadcn/SemanticView.svelte';
import AlertDialogComponent from '$lib/components/ui/alert-dialog/alert-dialog.svelte';
import { Badge as BadgeComponent } from '$lib/components/ui/badge';
import { Button as ButtonComponent } from '$lib/components/ui/button';
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
import IconComponent from './shadcn/Icon.svelte';
import ModelMatrixComponent from './shadcn/ModelMatrix.svelte';
import ColumnSplitterComponent from './shadcn/ColumnSplitter.svelte';
import AgentStatusMarkComponent from './shadcn/AgentStatusMark.svelte';
import type { UiKitAdapter, UiKitRegistration, UiThemeRegistration } from '../contract';

import metadata from '../../../../packages/presentation-shadcn/themes.json';

export const shadcnUiKit: UiKitAdapter = {
  HostPanel,
  ManagementCenter,
  SettingsSection,
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
  ModelMatrix: ModelMatrixComponent,
  Separator: SeparatorComponent,
  Textarea: TextareaComponent,
};

export const shadcnUiKitRegistration: UiKitRegistration = {...metadata, themes: metadata.themes as UiThemeRegistration[], adapter: shadcnUiKit};
