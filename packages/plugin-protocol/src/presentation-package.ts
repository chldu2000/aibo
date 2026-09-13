/** Installable skin and full-workbench extensions share this data-only package. */
export type PresentationPackageManifest = {
  schema: 'aibo.presentation-package/v1';
  id: string;
  version: string;
  displayName: string;
  hostApi: '1.0.0';
  coreSemantics: '1.0.0';
  snapshotSchemas: readonly ('aibo.semantic-view/experimental-v1' | 'aibo.semantic-view/v1' | 'aibo.semantic-view/v1.1')[];
  resources: readonly PresentationResource[];
  themes?: readonly PresentationTheme[];
  defaultThemeId?: string;
  entry?: string;
  surfaces?: readonly ('controls' | 'semantic' | 'workbench')[];
};

export type PresentationResource = {
  path: string;
  sha256: string;
  bytes: number;
  mediaType: 'text/javascript' | 'text/css' | 'image/png' | 'image/webp' | 'font/woff2';
};

export type PresentationTheme = {
  id: string;
  label: string;
  colorScheme: 'dark' | 'light';
  tokens: Readonly<Record<string, string>>;
};
