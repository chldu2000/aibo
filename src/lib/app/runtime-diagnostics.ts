import { translate, translateMessage, type Locale } from '../../../packages/i18n/index.js';
import { pluginDiagnosticsPresentation } from './plugin-diagnostics.ts';
import { sessionProviders, type SessionProviderInstallation } from './session-providers.ts';
import type { PluginAuthenticationState } from './plugin-authentication-controller.ts';

type Installation = SessionProviderInstallation & {
  manifest: { displayName: string; authentication?: unknown };
  dependencies: { name: string; required: boolean; available: boolean; issue: string | null; localizedIssue?: unknown }[];
  packageDependencies?: { dependencies: { pluginId: string; required: boolean; available: boolean; issue: string | null; localizedIssue?: unknown }[]; unavailableContributions: string[] };
  localizedActivationIssues?: unknown[];
};
export type RuntimeDiagnostic = {
  installationId: string;
  label: string;
  status: 'attention' | 'checked' | 'unchecked' | 'disabled';
  issues: string[];
  providers: string[];
  auth: string;
  authCheckedAt?: number;
};

/** A projection of existing plugin facts, not a second probe or an execution gate. */
export function runtimeDiagnostics(installations: Installation[], authentication: PluginAuthenticationState, locale: Locale): RuntimeDiagnostic[] {
  const t = (key: Parameters<typeof translate>[1], params = {}) => translate(locale, key, params);
  return installations.filter(item => item.installed).map(source => {
    const item = pluginDiagnosticsPresentation(source, locale);
    const issues: string[] = [];
    for (const dependency of item.dependencies) {
      if (!dependency.available) issues.push(t(dependency.required ? 'diagnostics.requiredDependency' : 'diagnostics.optionalDependency', { name: dependency.name, reason: dependency.issue ?? t('plugins.unavailable') }));
    }
    for (const dependency of item.packageDependencies?.dependencies ?? []) {
      if (!dependency.available) issues.push(t(dependency.required ? 'diagnostics.requiredDependency' : 'diagnostics.optionalDependency', { name: dependency.pluginId, reason: dependency.issue ?? t('plugins.unavailable') }));
    }
    issues.push(...(item.activationIssues ?? []));
    for (const id of item.packageDependencies?.unavailableContributions ?? []) {
      const contribution = item.contributions?.find(entry => entry.id === id);
      issues.push(t('diagnostics.contributionUnavailable', { name: typeof contribution?.metadata.displayName === 'string' ? contribution.metadata.displayName : id }));
    }
    if (!item.runnable && !issues.length) issues.push(t('diagnostics.notRunnable'));
    const entry = authentication.entries[item.id];
    let auth = t('diagnostics.authNotDeclared');
    if (item.manifest.authentication) {
      auth = t('diagnostics.authUnchecked');
      if (authentication.busyId === item.id) auth = t('plugins.authPending');
      else if (entry?.error) {
        auth = t('diagnostics.authCheckFailed');
        issues.push(translateMessage(locale, entry.error));
      } else if (entry?.result === 'unauthenticated') {
        auth = t('plugins.unauthenticated');
        issues.push(auth);
      } else if (entry?.result === 'authenticated') auth = t('diagnostics.authLastPassed');
      else if (entry?.result === 'loginOpened') auth = t('plugins.loginOpened');
    }
    return {
      installationId: item.id, label: item.manifest.displayName,
      status: !item.enabled ? 'disabled' : issues.length ? 'attention'
        : item.manifest.authentication && (authentication.busyId === item.id || entry?.result !== 'authenticated') ? 'unchecked' : 'checked',
      issues: [...new Set(issues)], providers: sessionProviders(item).map(provider => provider.displayName),
      auth, authCheckedAt: item.manifest.authentication ? entry?.checkedAt : undefined,
    };
  });
}
