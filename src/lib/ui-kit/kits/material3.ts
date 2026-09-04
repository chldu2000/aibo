import AlertDialog from './material3/AlertDialog.svelte';
import Badge from './material3/Badge.svelte';
import Button from './material3/Button.svelte';
import Card from './material3/Card.svelte';
import CardContent from './material3/CardContent.svelte';
import CardFooter from './material3/CardFooter.svelte';
import CardHeader from './material3/CardHeader.svelte';
import CardTitle from './material3/CardTitle.svelte';
import Icon from './material3/Icon.svelte';
import Input from './material3/Input.svelte';
import Label from './material3/Label.svelte';
import Separator from './material3/Separator.svelte';
import Textarea from './material3/Textarea.svelte';
import type { UiKitAdapter, UiKitRegistration, UiThemeRegistration } from '../contract';
import { lightStatusThemeTokens, statusThemeTokens } from '../theme-tokens';

/**
 * Experimental Material 3 adapter. It intentionally keeps the app primitive
 * contract identical to the shadcn adapter so the application layer remains
 * unaware of the selected visual system.
 */
export const material3UiKit: UiKitAdapter = {
  AlertDialog,
  Badge,
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  Icon,
  Input,
  Label,
  Separator,
  Textarea,
};

function theme(
  id: string,
  label: string,
  description: string,
  colors: {
    primary: string;
    onPrimary: string;
    primaryContainer: string;
    onPrimaryContainer: string;
    secondary: string;
    secondaryContainer: string;
    onSecondaryContainer: string;
  },
): UiThemeRegistration {
  return {
    id,
    label,
    description,
    colorScheme: 'dark',
    swatches: ['#101318', colors.primaryContainer, colors.primary],
    tokens: {
      '--aibo-color-scheme': 'dark',
      '--m3c-primary': colors.primary,
      '--m3c-on-primary': colors.onPrimary,
      '--m3c-primary-container': colors.primaryContainer,
      '--m3c-on-primary-container': colors.onPrimaryContainer,
      '--m3c-secondary': colors.secondary,
      '--m3c-on-secondary': '#283044',
      '--m3c-secondary-container': colors.secondaryContainer,
      '--m3c-on-secondary-container': colors.onSecondaryContainer,
      '--aibo-bg': '#101318',
      '--aibo-text': '#e2e2e9',
      '--aibo-muted': '#c4c6d0',
      '--aibo-subtle': '#92939c',
      '--aibo-border': '#44474f',
      '--aibo-border-strong': '#8e9099',
      '--aibo-surface': '#1c1b20',
      '--aibo-surface-hover': '#292a2f',
      '--aibo-accent': colors.primary,
      '--aibo-accent-hover': colors.onPrimaryContainer,
      '--aibo-accent-border': colors.primary,
      '--aibo-accent-soft': colors.primaryContainer,
      '--aibo-accent-text': colors.onPrimaryContainer,
      '--aibo-focus': colors.primary,
      ...statusThemeTokens,
    },
  };
}

export const material3UiKitRegistration: UiKitRegistration = {
  id: 'material3',
  label: 'Material 3',
  description: '强调层级、圆角与 Material Symbols 图标。',
  adapter: material3UiKit,
  defaultThemeId: 'ocean',
  themes: [
    theme('ocean', 'Ocean', '柔和蓝', {
      primary: '#a8c7fa',
      onPrimary: '#062e6f',
      primaryContainer: '#1a3f78',
      onPrimaryContainer: '#d8e2ff',
      secondary: '#bec6dc',
      secondaryContainer: '#3e475e',
      onSecondaryContainer: '#dae2f9',
    }),
    theme('sage', 'Sage', '自然绿', {
      primary: '#a8d5ba',
      onPrimary: '#0d3824',
      primaryContainer: '#24513a',
      onPrimaryContainer: '#c3f1d3',
      secondary: '#b7ccbd',
      secondaryContainer: '#354b3d',
      onSecondaryContainer: '#d3e8d8',
    }),
    theme('violet', 'Violet', '低饱和紫', {
      primary: '#d0bcff',
      onPrimary: '#381e72',
      primaryContainer: '#4f378b',
      onPrimaryContainer: '#eaddff',
      secondary: '#ccc2dc',
      secondaryContainer: '#4a4458',
      onSecondaryContainer: '#e8def8',
    }),
    {
      id: 'daylight',
      label: 'Daylight',
      description: '明亮蓝灰',
      colorScheme: 'light',
      swatches: ['#f9f9ff', '#d6e3ff', '#415f91'],
      tokens: {
        '--aibo-color-scheme': 'light',
        '--m3c-primary': '#415f91',
        '--m3c-on-primary': '#ffffff',
        '--m3c-primary-container': '#d6e3ff',
        '--m3c-on-primary-container': '#284777',
        '--m3c-secondary': '#565f71',
        '--m3c-on-secondary': '#ffffff',
        '--m3c-secondary-container': '#dae2f9',
        '--m3c-on-secondary-container': '#3e475e',
        '--m3c-tertiary-container': '#f2daff',
        '--m3c-on-tertiary-container': '#584066',
        '--m3c-surface': '#f9f9ff',
        '--m3c-surface-container': '#ededf4',
        '--m3c-surface-container-low': '#f3f3fa',
        '--m3c-surface-container-high': '#e2e2e9',
        '--m3c-surface-container-highest': '#dcdce3',
        '--m3c-on-surface': '#191c20',
        '--m3c-on-surface-variant': '#44474f',
        '--m3c-outline': '#74777f',
        '--m3c-outline-variant': '#c4c6d0',
        '--m3c-shadow': '#000000',
        '--aibo-bg': '#f9f9ff',
        '--aibo-text': '#191c20',
        '--aibo-muted': '#44474f',
        '--aibo-subtle': '#5f626a',
        '--aibo-border': '#dfe2eb',
        '--aibo-border-strong': '#c4c6d0',
        '--aibo-surface': '#ededf4',
        '--aibo-surface-hover': '#e2e2e9',
        '--aibo-accent': '#415f91',
        '--aibo-accent-hover': '#284777',
        '--aibo-accent-border': '#415f91',
        '--aibo-accent-soft': '#d6e3ff',
        '--aibo-accent-text': '#284777',
        '--aibo-focus': '#415f91',
        ...lightStatusThemeTokens,
      },
    },
  ],
};
