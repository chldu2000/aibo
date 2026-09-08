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
import ModelMatrix from './material3/ModelMatrix.svelte';
import ColumnSplitter from './material3/ColumnSplitter.svelte';
import AgentStatusMark from './material3/AgentStatusMark.svelte';
import PluginView from './material3/PluginView.svelte';
import type { UiKitAdapter, UiKitRegistration, UiThemeRegistration } from '../contract';
import { lightStatusThemeTokens, statusThemeTokens } from '../theme-tokens';

/**
 * Experimental Material 3 adapter. It intentionally keeps the app primitive
 * contract identical to the shadcn adapter so the application layer remains
 * unaware of the selected visual system.
 */
export const material3UiKit: UiKitAdapter = {
  PluginView,
  AgentStatusMark,
  AlertDialog,
  Badge,
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  ColumnSplitter,
  Icon,
  Input,
  Label,
  ModelMatrix,
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
    onSecondary?: string;
    secondaryContainer: string;
    onSecondaryContainer: string;
    tertiary?: string;
    onTertiary?: string;
    tertiaryContainer?: string;
    onTertiaryContainer?: string;
    error?: string;
    onError?: string;
    errorContainer?: string;
    onErrorContainer?: string;
    surface?: string;
    surfaceContainer?: string;
    surfaceContainerLow?: string;
    surfaceContainerHigh?: string;
    surfaceContainerHighest?: string;
    onSurface?: string;
    onSurfaceVariant?: string;
    outline?: string;
    outlineVariant?: string;
  },
): UiThemeRegistration {
  const surface = colors.surface ?? '#101318';
  const surfaceContainer = colors.surfaceContainer ?? '#1c1b20';
  const surfaceContainerLow = colors.surfaceContainerLow ?? '#191a1f';
  const surfaceContainerHigh = colors.surfaceContainerHigh ?? '#292a2f';
  const surfaceContainerHighest = colors.surfaceContainerHighest ?? '#34353a';
  const onSurface = colors.onSurface ?? '#e2e2e9';
  const onSurfaceVariant = colors.onSurfaceVariant ?? '#c4c6d0';
  const outline = colors.outline ?? '#8e9099';
  const outlineVariant = colors.outlineVariant ?? '#44474f';
  const tertiary = colors.tertiary ?? '#d8b9e8';
  const onTertiary = colors.onTertiary ?? '#3f2848';
  const tertiaryContainer = colors.tertiaryContainer ?? '#5a3f5d';
  const onTertiaryContainer = colors.onTertiaryContainer ?? '#ffd7fa';
  const error = colors.error ?? '#ffb4ab';
  const onError = colors.onError ?? '#690005';
  const errorContainer = colors.errorContainer ?? '#93000a';
  const onErrorContainer = colors.onErrorContainer ?? '#ffdad6';
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
      '--m3c-on-secondary': colors.onSecondary ?? '#283044',
      '--m3c-secondary-container': colors.secondaryContainer,
      '--m3c-on-secondary-container': colors.onSecondaryContainer,
      '--m3c-tertiary': tertiary,
      '--m3c-on-tertiary': onTertiary,
      '--m3c-tertiary-container': tertiaryContainer,
      '--m3c-on-tertiary-container': onTertiaryContainer,
      '--m3c-error': error,
      '--m3c-on-error': onError,
      '--m3c-error-container': errorContainer,
      '--m3c-on-error-container': onErrorContainer,
      '--m3c-surface': surface,
      '--m3c-surface-container': surfaceContainer,
      '--m3c-surface-container-low': surfaceContainerLow,
      '--m3c-surface-container-high': surfaceContainerHigh,
      '--m3c-surface-container-highest': surfaceContainerHighest,
      '--m3c-on-surface': onSurface,
      '--m3c-on-surface-variant': onSurfaceVariant,
      '--m3c-outline': outline,
      '--m3c-outline-variant': outlineVariant,
      '--m3c-shadow': '#000000',
      '--m3c-scrim': '#000000',
      '--m3-shape-extra-small': '4px',
      '--m3-shape-small': '8px',
      '--m3-shape-medium': '12px',
      '--m3-shape-large': '16px',
      '--m3-shape-full': '9999px',
      '--m3-card-shape': '12px',
      '--m3-font': "'Google Sans Flex', 'Google Sans', Inter, ui-sans-serif, system-ui, sans-serif",
      '--m3-font-mono': "'Google Sans Code', ui-monospace, SFMono-Regular, Menlo, monospace",
      '--m3-label-large-size': '14px',
      '--m3-label-large-weight': '500',
      '--m3-label-large-line-height': '20px',
      '--m3-label-large-tracking': '0.1px',
      '--m3-label-medium-size': '12px',
      '--m3-label-medium-weight': '500',
      '--m3-label-medium-line-height': '16px',
      '--m3-label-medium-tracking': '0.5px',
      '--m3-label-small-size': '11px',
      '--m3-label-small-weight': '500',
      '--m3-label-small-line-height': '16px',
      '--m3-label-small-tracking': '0.5px',
      '--m3-title-medium-size': '16px',
      '--m3-title-medium-weight': '500',
      '--m3-title-medium-line-height': '24px',
      '--m3-title-medium-tracking': '0.15px',
      '--m3-body-large-size': '16px',
      '--m3-body-large-weight': '400',
      '--m3-body-large-line-height': '24px',
      '--m3-body-large-tracking': '0.5px',
      '--m3-body-medium-size': '14px',
      '--m3-body-medium-weight': '400',
      '--m3-body-medium-line-height': '20px',
      '--m3-body-medium-tracking': '0.25px',
      '--m3-body-small-size': '12px',
      '--m3-body-small-weight': '400',
      '--m3-body-small-line-height': '16px',
      '--m3-body-small-tracking': '0.4px',
      '--m3-elevation-1': '0 1px 2px rgb(0 0 0 / 0.3), 0 1px 3px 1px rgb(0 0 0 / 0.15)',
      '--m3-elevation-2': '0 1px 2px rgb(0 0 0 / 0.3), 0 2px 6px 2px rgb(0 0 0 / 0.15)',
      '--m3-easing-fast': '150ms ease',
      '--m3-easing-fast-spatial': '250ms cubic-bezier(0.2, 0, 0, 1)',
      '--background': surface,
      '--foreground': onSurface,
      '--card': surfaceContainer,
      '--card-foreground': onSurface,
      '--popover': surfaceContainerHigh,
      '--popover-foreground': onSurface,
      '--primary': colors.primary,
      '--primary-foreground': colors.onPrimary,
      '--secondary': colors.secondaryContainer,
      '--secondary-foreground': colors.onSecondaryContainer,
      '--muted': surfaceContainerLow,
      '--muted-foreground': onSurfaceVariant,
      '--accent': colors.primaryContainer,
      '--accent-foreground': colors.onPrimaryContainer,
      '--destructive': error,
      '--destructive-foreground': onError,
      '--border': outlineVariant,
      '--input': outline,
      '--ring': colors.primary,
      '--radius': '0.75rem',
      '--aibo-bg': surface,
      '--aibo-text': onSurface,
      '--aibo-muted': onSurfaceVariant,
      '--aibo-subtle': onSurfaceVariant,
      '--aibo-border': outlineVariant,
      '--aibo-border-strong': outline,
      '--aibo-surface': surfaceContainer,
      '--aibo-surface-hover': surfaceContainerHigh,
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
        '--m3c-tertiary': '#705575',
        '--m3c-on-tertiary': '#ffffff',
        '--m3c-tertiary-container': '#f2daff',
        '--m3c-on-tertiary-container': '#584066',
        '--m3c-error': '#ba1a1a',
        '--m3c-on-error': '#ffffff',
        '--m3c-error-container': '#ffdad6',
        '--m3c-on-error-container': '#93000a',
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
        '--m3c-scrim': '#000000',
        '--m3-shape-extra-small': '4px',
        '--m3-shape-small': '8px',
        '--m3-shape-medium': '12px',
        '--m3-shape-large': '16px',
        '--m3-shape-full': '9999px',
        '--m3-card-shape': '12px',
        '--m3-font': "'Google Sans Flex', 'Google Sans', Inter, ui-sans-serif, system-ui, sans-serif",
        '--m3-font-mono': "'Google Sans Code', ui-monospace, SFMono-Regular, Menlo, monospace",
        '--m3-label-large-size': '14px',
        '--m3-label-large-weight': '500',
        '--m3-label-large-line-height': '20px',
        '--m3-label-large-tracking': '0.1px',
        '--m3-label-medium-size': '12px',
        '--m3-label-medium-weight': '500',
        '--m3-label-medium-line-height': '16px',
        '--m3-label-medium-tracking': '0.5px',
        '--m3-label-small-size': '11px',
        '--m3-label-small-weight': '500',
        '--m3-label-small-line-height': '16px',
        '--m3-label-small-tracking': '0.5px',
        '--m3-title-medium-size': '16px',
        '--m3-title-medium-weight': '500',
        '--m3-title-medium-line-height': '24px',
        '--m3-title-medium-tracking': '0.15px',
        '--m3-body-large-size': '16px',
        '--m3-body-large-weight': '400',
        '--m3-body-large-line-height': '24px',
        '--m3-body-large-tracking': '0.5px',
        '--m3-body-medium-size': '14px',
        '--m3-body-medium-weight': '400',
        '--m3-body-medium-line-height': '20px',
        '--m3-body-medium-tracking': '0.25px',
        '--m3-body-small-size': '12px',
        '--m3-body-small-weight': '400',
        '--m3-body-small-line-height': '16px',
        '--m3-body-small-tracking': '0.4px',
        '--m3-elevation-1': '0 1px 2px rgb(0 0 0 / 0.15), 0 1px 3px 1px rgb(0 0 0 / 0.08)',
        '--m3-elevation-2': '0 1px 2px rgb(0 0 0 / 0.15), 0 2px 6px 2px rgb(0 0 0 / 0.08)',
        '--m3-easing-fast': '150ms ease',
        '--m3-easing-fast-spatial': '250ms cubic-bezier(0.2, 0, 0, 1)',
        '--background': '#f9f9ff',
        '--foreground': '#191c20',
        '--card': '#ededf4',
        '--card-foreground': '#191c20',
        '--popover': '#e2e2e9',
        '--popover-foreground': '#191c20',
        '--primary': '#415f91',
        '--primary-foreground': '#ffffff',
        '--secondary': '#dae2f9',
        '--secondary-foreground': '#3e475e',
        '--muted': '#f3f3fa',
        '--muted-foreground': '#44474f',
        '--accent': '#d6e3ff',
        '--accent-foreground': '#284777',
        '--destructive': '#ba1a1a',
        '--destructive-foreground': '#ffffff',
        '--border': '#c4c6d0',
        '--input': '#74777f',
        '--ring': '#415f91',
        '--radius': '0.75rem',
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
