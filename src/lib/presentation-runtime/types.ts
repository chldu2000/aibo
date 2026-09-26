import type { PresentationPackageManifest } from '../../../packages/plugin-protocol/src/presentation-package';

export type PresentationRelease = {
  digest: string;
  manifest: PresentationPackageManifest;
  enabled: boolean;
  /** Assigned by the host from the reserved identity prefix, never by the manifest. */
  source: 'builtin' | 'local';
};
export type InstalledPresentationPackage = {
  release: PresentationRelease;
  /** Base64-encoded verified resources; never native paths or arbitrary URLs. */
  resources: Record<string, string>;
};
export type PresentationSelection = { digest: string; themeId: string | null };
