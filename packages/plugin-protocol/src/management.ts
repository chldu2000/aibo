import type { CapabilityScope } from './capability.js';

/** Static management contributions. Dynamic providers require a later negotiated contract. */
export type ManagementSettingsReference = {
  key: string;
  contributionId: string;
  scopes: CapabilityScope['kind'][];
};
export type ManagementSection = {
  id: string;
  title: string;
  scopes: CapabilityScope['kind'][];
  settingsReferences: ManagementSettingsReference[];
};
export type ManagementPanelDeclaration = {
  kind: 'managementPanel';
  id: string;
  scope: 'application';
  required: false;
  title: string;
  contractVersion: '1.0.0';
  relatedContributions: string[];
  sections: ManagementSection[];
};
