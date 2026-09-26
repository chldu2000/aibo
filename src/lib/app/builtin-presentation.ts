import type { PresentationRelease, PresentationSelection } from '../presentation-runtime/types';

type BuiltinKit = { id: string; packageId?: string; defaultThemeId: string; themes: readonly { id: string }[] };

/** The registered release for a built-in kit choice; null when the host has not registered it. */
export function builtinSelection(
  releases: readonly PresentationRelease[],
  kits: readonly BuiltinKit[],
  choice: { kitId: string; themeId: string },
): PresentationSelection | null {
  const kit = kits.find(kit => kit.id === choice.kitId);
  const release = kit?.packageId
    ? releases.find(release => release.source === 'builtin' && release.enabled && release.manifest.id === kit.packageId)
    : undefined;
  return release ? { digest: release.digest, themeId: choice.themeId } : null;
}

/** Resolve a committed built-in release to the trusted kit compiled into this build. */
export function builtinAppearance(release: PresentationRelease, themeId: string | null, kits: readonly BuiltinKit[]) {
  const kit = release.source === 'builtin' ? kits.find(kit => kit.packageId === release.manifest.id) : undefined;
  if (!kit) throw Error('presentation_unavailable');
  const theme = themeId ?? kit.defaultThemeId;
  if (!kit.themes.some(candidate => candidate.id === theme)) throw Error('invalid_presentation_theme');
  return { kitId: kit.id, themeId: theme };
}
