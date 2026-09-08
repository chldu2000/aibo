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
import PluginViewComponent from './shadcn/PluginView.svelte';
import type { UiKitAdapter, UiKitRegistration, UiThemeRegistration } from '../contract';
import { lightStatusThemeTokens, statusThemeTokens } from '../theme-tokens';

type ShadcnColorTokens = {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  popover: string;
  popoverForeground: string;
  primary: string;
  primaryForeground: string;
  primaryHover: string;
  secondary: string;
  secondaryForeground: string;
  secondaryHover: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  destructive: string;
  destructiveForeground: string;
  destructiveSurface: string;
  destructiveHover: string;
  border: string;
  input: string;
  ring: string;
};

function semanticTokens(colors: ShadcnColorTokens): Record<`--${string}`, string> {
  return {
    '--background': colors.background,
    '--foreground': colors.foreground,
    '--card': colors.card,
    '--card-foreground': colors.cardForeground,
    '--popover': colors.popover,
    '--popover-foreground': colors.popoverForeground,
    '--primary': colors.primary,
    '--primary-foreground': colors.primaryForeground,
    '--primary-hover': colors.primaryHover,
    '--secondary': colors.secondary,
    '--secondary-foreground': colors.secondaryForeground,
    '--secondary-hover': colors.secondaryHover,
    '--muted': colors.muted,
    '--muted-foreground': colors.mutedForeground,
    '--accent': colors.accent,
    '--accent-foreground': colors.accentForeground,
    '--destructive': colors.destructive,
    '--destructive-foreground': colors.destructiveForeground,
    '--destructive-surface': colors.destructiveSurface,
    '--destructive-hover': colors.destructiveHover,
    '--border': colors.border,
    '--input': colors.input,
    '--ring': colors.ring,
    '--radius': '0.5rem',
  };
}

export const shadcnUiKit: UiKitAdapter = {
  PluginView: PluginViewComponent,
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

function theme(
  id: string,
  label: string,
  description: string,
  accent: string,
  accentHover: string,
  accentSoft: string,
  accentText: string,
  primaryForeground: string,
): UiThemeRegistration {
  return {
    id,
    label,
    description,
    colorScheme: 'dark',
    swatches: ['#09090b', '#18181b', accent],
    tokens: {
      ...semanticTokens({
        background: '#09090b',
        foreground: '#fafafa',
        card: '#18181b',
        cardForeground: '#fafafa',
        popover: '#18181b',
        popoverForeground: '#fafafa',
        primary: accent,
        primaryForeground,
        primaryHover: accentHover,
        secondary: '#27272a',
        secondaryForeground: '#fafafa',
        secondaryHover: '#3f3f46',
        muted: '#18181b',
        mutedForeground: '#a1a1aa',
        accent: accentSoft,
        accentForeground: accentText,
        destructive: '#ef4444',
        destructiveForeground: '#fff1f2',
        destructiveSurface: '#451a1a',
        destructiveHover: '#dc2626',
        border: '#27272a',
        input: '#3f3f46',
        ring: accent,
      }),
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
  description: '中性、清晰，遵循 shadcn-svelte 的默认组件密度。',
  adapter: shadcnUiKit,
  defaultThemeId: 'zinc',
  themes: [
    theme('zinc', 'Zinc', '中性灰', '#fafafa', '#e4e4e7', '#27272a', '#fafafa', '#18181b'),
    theme('blue', 'Blue', '沉静蓝', '#60a5fa', '#93c5fd', '#172554', '#dbeafe', '#172554'),
    theme('emerald', 'Emerald', '清晰绿', '#34d399', '#6ee7b7', '#052e16', '#d1fae5', '#052e16'),
    {
      id: 'light',
      label: 'Light',
      description: '明亮中性',
      colorScheme: 'light',
      swatches: ['#fafafa', '#ffffff', '#18181b'],
      tokens: {
        ...semanticTokens({
          background: '#fafafa',
          foreground: '#09090b',
          card: '#ffffff',
          cardForeground: '#09090b',
          popover: '#ffffff',
          popoverForeground: '#09090b',
          primary: '#18181b',
          primaryForeground: '#fafafa',
          primaryHover: '#27272a',
          secondary: '#e4e4e7',
          secondaryForeground: '#18181b',
          secondaryHover: '#d4d4d8',
          muted: '#f4f4f5',
          mutedForeground: '#52525b',
          accent: '#f4f4f5',
          accentForeground: '#18181b',
          destructive: '#dc2626',
          destructiveForeground: '#fff7ed',
          destructiveSurface: '#fef2f2',
          destructiveHover: '#b91c1c',
          border: '#e4e4e7',
          input: '#d4d4d8',
          ring: '#52525b',
        }),
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
