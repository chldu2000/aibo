import SettingsSection from './material3/SettingsSection.svelte';
import HostPanel from './shared/HostPanel.svelte';
import ManagementCenter from './material3/ManagementCenter.svelte';
import SemanticView from './material3/SemanticView.svelte';
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
import type { UiKitAdapter, UiKitRegistration, UiThemeRegistration } from '../contract';

import metadata from '../../../../packages/presentation-material3/themes.json';

export const material3UiKit: UiKitAdapter = {
  HostPanel,
  ManagementCenter,
  SettingsSection,
  SemanticView,
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

export const material3UiKitRegistration: UiKitRegistration = {...metadata, themes: metadata.themes as UiThemeRegistration[], adapter: material3UiKit};
