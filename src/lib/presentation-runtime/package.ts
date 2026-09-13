import validate from './package-validator.js';
import type { PresentationPackageManifest } from '../../../packages/plugin-protocol/src/presentation-package';

export const PRESENTATION_PACKAGE_LIMIT = 32 * 1024 * 1024;
export const PRESENTATION_MANIFEST_LIMIT = 128 * 1024;

/** Deliberately excludes CSS URLs, escapes, comments, declaration separators and blocks. */
export function isPresentationToken(value: string): boolean {
  return /^[a-zA-Z0-9#.,%() /+*-]+$/.test(value)
    && !/url|expression|image|paint|attr|env|\/\*|\*\//i.test(value)
    && !/[;{}<>\\@:'"]/.test(value);
}

export function parsePresentationManifest(source: string): PresentationPackageManifest {
  if (new TextEncoder().encode(source).byteLength > PRESENTATION_MANIFEST_LIMIT) throw Error('presentation_manifest_too_large');
  const value: unknown = JSON.parse(source);
  if (!validate(value)) throw Error('invalid_presentation_manifest');
  const manifest = value as PresentationPackageManifest;
  const paths = new Set<string>();
  let bytes = 0;
  for (const resource of manifest.resources) {
    // Case folding makes a release portable to case-insensitive desktop filesystems.
    const path = resource.path.toLowerCase();
    if (paths.has(path) || path === 'presentation.json') throw Error('duplicate_presentation_resource');
    paths.add(path);
    bytes += resource.bytes;
  }
  if (bytes > PRESENTATION_PACKAGE_LIMIT) throw Error('presentation_package_too_large');
  if (manifest.entry && !manifest.resources.some(resource => resource.path === manifest.entry && resource.mediaType === 'text/javascript')) {
    throw Error('missing_presentation_entry');
  }
  if (!manifest.entry && manifest.resources.some(resource => resource.mediaType === 'text/javascript')) {
    throw Error('unexpected_presentation_script');
  }
  if (manifest.themes) {
    const ids = new Set(manifest.themes.map(theme => theme.id));
    if (ids.size !== manifest.themes.length || !ids.has(manifest.defaultThemeId!)) throw Error('invalid_presentation_themes');
    for (const theme of manifest.themes) {
      if (!Object.values(theme.tokens).every(isPresentationToken)) throw Error('unsafe_presentation_token');
    }
  }
  return manifest;
}

/** The caller supplies bytes from its platform; verification has no filesystem authority. */
export async function verifyPresentationPackage(
  source: string,
  readResource: (path: string) => Promise<Uint8Array>,
): Promise<{ manifest: PresentationPackageManifest; resources: ReadonlyMap<string, Uint8Array> }> {
  const manifest = parsePresentationManifest(source);
  const resources = new Map<string, Uint8Array>();
  for (const descriptor of manifest.resources) {
    const bytes = new Uint8Array(await readResource(descriptor.path));
    if (bytes.byteLength !== descriptor.bytes) throw Error('presentation_resource_size_mismatch');
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hex = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    if (hex !== descriptor.sha256) throw Error('presentation_resource_integrity_mismatch');
    resources.set(descriptor.path, bytes);
  }
  return { manifest, resources };
}
