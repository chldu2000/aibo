import type { InstalledPresentationPackage, PresentationRelease, PresentationSelection } from '../presentation-runtime/types';

export type PresentationInstance = { activate(): void; dispose(): void };
export type PresentationPackageState = {
  releases: PresentationRelease[];
  active: InstalledPresentationPackage | null;
  themeId: string | null;
  busy: boolean;
  error: string;
};

/** Owns selection transactions; visual mounting and native storage are injected. */
export function createPresentationPackageController(ports: {
  list(): Promise<PresentationRelease[]>;
  read(digest: string): Promise<InstalledPresentationPackage>;
  install(path: string): Promise<PresentationRelease>;
  enable(digest: string, enabled: boolean): Promise<void>;
  uninstall(digest: string): Promise<void>;
  selection(): Promise<PresentationSelection | null>;
  persist(digest: string | null, themeId: string | null, expected: string | null): Promise<void>;
  prepare(value: InstalledPresentationPackage, themeId: string | null, failure: (error: Error) => void, signal: AbortSignal): Promise<PresentationInstance>;
  changed(state: PresentationPackageState): void;
}) {
  let state: PresentationPackageState = { releases: [], active: null, themeId: null, busy: false, error: '' };
  let instance: PresentationInstance | null = null;
  let abort: AbortController | null = null;
  let requested = 0, refreshRequested = 0, disposed = false;
  let queue: Promise<unknown> = Promise.resolve();
  const emit = () => { if (!disposed) ports.changed({ ...state, releases: [...state.releases] }); };
  const report = (error: unknown) => { state.error = String(error instanceof Error ? error.message : error); emit(); };

  async function refresh() {
    const ticket = ++refreshRequested;
    try {
      const releases = await ports.list();
      if (disposed || ticket !== refreshRequested) return;
      state.releases = releases;
      if (state.active && !state.releases.some(release => release.digest === state.active?.release.digest && release.enabled)) {
        await select(null);
      }
      emit();
    } catch (error) { report(error); }
  }

  function select(digest: string | null, requestedTheme: string | null = null): Promise<void> {
    const ticket = ++requested;
    abort?.abort();
    const operation = queue.catch(() => {}).then(async () => {
      if (disposed || ticket !== requested) return;
      state.busy = true; state.error = ''; emit();
      const preparation = new AbortController(); abort = preparation;
      let candidate: PresentationInstance | null = null;
      let committed = false;
      const previous = instance;
      const previousSelection = { digest: state.active?.release.digest ?? null, themeId: state.themeId };
      try {
        const saved = await ports.selection();
        const value = digest ? await ports.read(digest) : null;
        const themeId = value ? requestedTheme ?? value.release.manifest.defaultThemeId ?? null : null;
        if (themeId && !value?.release.manifest.themes?.some(theme => theme.id === themeId)) throw Error('invalid_presentation_theme');
        let failed: Error | null = null;
        if (value) candidate = await ports.prepare(value, themeId, error => {
          failed = error;
          if (candidate && instance === candidate && !disposed) {
            void select(null).then(() => report(error), report);
          }
        }, preparation.signal);
        if (disposed || ticket !== requested || preparation.signal.aborted) { candidate?.dispose(); return; }
        await ports.persist(digest, themeId, saved?.digest ?? null);
        committed = true;
        if (disposed) {
          candidate?.dispose();
          await ports.persist(previousSelection.digest, previousSelection.themeId, digest);
          return;
        }
        if (failed) throw failed;
        candidate?.activate();
        instance = candidate;
        state.active = value; state.themeId = themeId;
        previous?.dispose();
        emit();
      } catch (error) {
        candidate?.dispose();
        if (committed) {
          try { await ports.persist(previousSelection.digest, previousSelection.themeId, digest); }
          catch (rollback) { report(`presentation_rollback_failed: ${rollback}`); throw rollback; }
        }
        if (!preparation.signal.aborted && !disposed) { report(error); throw error; }
      } finally {
        if (abort === preparation) abort = null;
        if (ticket === requested) { state.busy = false; emit(); }
      }
    });
    queue = operation;
    return operation;
  }

  async function initialize() {
    const ticket = requested;
    await refresh();
    const saved = await ports.selection();
    if (!saved || disposed || ticket !== requested) return;
    try { await select(saved.digest, saved.themeId); }
    catch (error) {
      // Corrupt or missing startup candidates must not retry on every launch.
      await ports.persist(null, null, saved.digest);
      report(error);
    }
  }

  return {
    initialize, refresh, select,
    async install(path: string) { const release = await ports.install(path); await refresh(); return release; },
    async enable(digest: string, enabled: boolean) { await ports.enable(digest, enabled); await refresh(); },
    async uninstall(digest: string) { await ports.uninstall(digest); await refresh(); },
    dispose() { disposed = true; ++requested; abort?.abort(); instance?.dispose(); instance = null; },
  };
}
