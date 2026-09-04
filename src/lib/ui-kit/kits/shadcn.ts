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
import type { UiKitAdapter } from '../contract';

export const shadcnUiKit: UiKitAdapter = {
  AlertDialog: AlertDialogComponent,
  Badge: BadgeComponent,
  Button: ButtonComponent,
  Card: CardComponent,
  CardContent: CardContentComponent,
  CardFooter: CardFooterComponent,
  CardHeader: CardHeaderComponent,
  CardTitle: CardTitleComponent,
  Input: InputComponent,
  Label: LabelComponent,
  Separator: SeparatorComponent,
  Textarea: TextareaComponent,
};
