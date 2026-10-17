import type { CapabilityScope } from './capability.js';

/** Ordinary settings and explicitly declared read-only management data. */
export type ManagementSettingsReference = {
  key: string;
  contributionId: string;
  scopes: CapabilityScope['kind'][];
};
export type ManagementSection = {
  id: string;
  title: string;
  scopes: CapabilityScope['kind'][];
  settingsReferences?: ManagementSettingsReference[];
  providers?: { application: { contributionId: string; readOperationId: string } };
};
export type ManagementPanelDeclaration = {
  kind: 'managementPanel';
  id: string;
  scope: 'application';
  required: false;
  title: string;
  contractVersion: '1.0.0' | '1.1.0';
  relatedContributions: string[];
  sections: ManagementSection[];
};

export type ManagementReadTarget = { installationId: string; panelId: string; sectionId: string };
export type ManagementData = {
  schema: 'aibo.management-data/v1';
  target: { id: string; label: string };
  state: 'ready' | 'unavailable';
  message: string;
  observedAt: string;
  properties: { key: string; label: string; value: string }[];
  metrics: { key: string; label: string; value: number; unit: string; maximum?: number; resetsAt?: number | null }[];
};
