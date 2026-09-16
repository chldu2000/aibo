import type { CapabilityScope } from './capability.js';

/** Ordinary configuration only. Credentials must not be stored in this protocol. */
export type AgentSettingValue = string | number | boolean;
export type AgentSettingField = {
  key: string; label: string; description?: string;
  type: 'text' | 'multiline' | 'boolean' | 'number' | 'select';
  default: AgentSettingValue;
  options?: { value: string; label: string }[];
  min?: number; max?: number; maxLength?: number;
};
export type AgentSettingsDescriptor = {
  schema: 'aibo.agent-settings/v1'; version: number; title: string; description?: string;
  scopes: CapabilityScope['kind'][]; fields: AgentSettingField[];
};
export type AgentSettingsTarget = { installationId: string; contributionId: string; scope: CapabilityScope };
export type AgentSettingsSnapshot = {
  target: AgentSettingsTarget; descriptor: AgentSettingsDescriptor; revision: number;
  values: Record<string, AgentSettingValue>; effectiveValues: Record<string, AgentSettingValue>; inheritedValues: Record<string, AgentSettingValue>;
};
/** Replace overrides at this scope. Omitted fields inherit; {} resets the scope. */
export type AgentSettingsSave = AgentSettingsTarget & {
  version: number; expectedRevision: number; values: Record<string, AgentSettingValue>;
};
/** Host-resolved immutable snapshot for this invocation, never caller-supplied input. */
export type AgentSettingsContext = {
  schema: 'aibo.agent-settings/v1'; version: number; values: Record<string, AgentSettingValue>;
};
