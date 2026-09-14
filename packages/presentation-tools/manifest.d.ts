import type { PresentationPackageManifest } from '@aibo/plugin-protocol';
export const PRESENTATION_PACKAGE_LIMIT: number;
export const PRESENTATION_MANIFEST_LIMIT: number;
export function isPresentationToken(value: string): boolean;
export function parsePresentationManifest(source: string): PresentationPackageManifest;
export function verifyPresentationPackage(source: string, readResource: (path: string) => Promise<Uint8Array>): Promise<{manifest: PresentationPackageManifest; resources: ReadonlyMap<string, Uint8Array>}>;
