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
import type { UiKitAdapter, UiKitRegistration, UiThemeRegistration } from '../contract';
import { lightStatusThemeTokens, statusThemeTokens } from '../theme-tokens';

export const shadcnUiKit: UiKitAdapter = {
  AlertDialog: AlertDialogComponent,
  Badge: BadgeComponent,
  Button: ButtonComponent,
  Card: CardComponent,
  CardContent: CardContentComponent,
  CardFooter: CardFooterComponent,
  CardHeader: CardHeaderComponent,
  CardTitle: CardTitleComponent,
  Icon: IconComponent,
  Input: InputComponent,
  Label: LabelComponent,
  Separator: SeparatorComponent,
  Textarea: TextareaComponent,
};

function theme(
  id: string,
  label: string,
  description: string,
  accent: string,
  accentHover: string,
  accentSoft: string,
  accentText: string,
): UiThemeRegistration {
  return {
    id,
    label,
    description,
    colorScheme: 'dark',
    swatches: ['#09090b', '#18181b', accent],
    tokens: {
      '--aibo-color-scheme': 'dark',
      '--aibo-bg': '#09090b',
      '--aibo-text': '#fafafa',
      '--aibo-muted': '#a1a1aa',
      '--aibo-subtle': '#71717a',
      '--aibo-border': '#27272a',
      '--aibo-border-strong': '#3f3f46',
      '--aibo-surface': '#18181b',
      '--aibo-surface-hover': '#27272a',
      '--aibo-accent': accent,
      '--aibo-accent-hover': accentHover,
      '--aibo-accent-border': accent,
      '--aibo-accent-soft': accentSoft,
      '--aibo-accent-text': accentText,
      '--aibo-focus': accent,
      ...statusThemeTokens,
    },
  };
}

export const shadcnUiKitRegistration: UiKitRegistration = {
  id: 'shadcn',
  label: 'shadcn-svelte',
  description: '紧凑、中性，适合高密度桌面工作流。',
  adapter: shadcnUiKit,
  defaultThemeId: 'zinc',
  themes: [
    theme('zinc', 'Zinc', '中性灰', '#fafafa', '#e4e4e7', '#27272a', '#fafafa'),
    theme('blue', 'Blue', '沉静蓝', '#60a5fa', '#93c5fd', '#172554', '#dbeafe'),
    theme('emerald', 'Emerald', '清晰绿', '#34d399', '#6ee7b7', '#052e16', '#d1fae5'),
    {
      id: 'light',
      label: 'Light',
      description: '明亮中性',
      colorScheme: 'light',
      swatches: ['#fafafa', '#ffffff', '#18181b'],
      tokens: {
        '--aibo-color-scheme': 'light',
        '--aibo-bg': '#fafafa',
        '--aibo-text': '#09090b',
        '--aibo-muted': '#52525b',
        '--aibo-subtle': '#71717a',
        '--aibo-border': '#e4e4e7',
        '--aibo-border-strong': '#d4d4d8',
        '--aibo-surface': '#ffffff',
        '--aibo-surface-hover': '#f4f4f5',
        '--aibo-accent': '#18181b',
        '--aibo-accent-hover': '#27272a',
        '--aibo-accent-border': '#18181b',
        '--aibo-accent-soft': '#e4e4e7',
        '--aibo-accent-text': '#18181b',
        '--aibo-focus': '#52525b',
        ...lightStatusThemeTokens,
      },
    },
  ],
};
