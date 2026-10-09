import {translateMessage} from '../../../packages/i18n/index.js';
import type {Locale} from '../../../packages/i18n/index.js';
import {readNativeMessage} from './error-utils.ts';

type DependencyDiagnostic = {issue: string | null; localizedIssue?: unknown};
type InstallationDiagnostics = {dependencies: DependencyDiagnostic[]; packageDependencies?: {dependencies: DependencyDiagnostic[]}; activationIssues?: string[]; localizedActivationIssues?: unknown[]};

function dependencyPresentation<T extends DependencyDiagnostic>(dependency: T, locale: Locale) {
  const {localizedIssue, ...plain} = dependency;
  const message = readNativeMessage(localizedIssue);
  return {...plain, issue: message ? translateMessage(locale, message) : dependency.issue};
}

/** Semantic catalog issues share the display boundary; titles and availability stay canonical. */
export function semanticContributionPresentation<T extends DependencyDiagnostic>(contribution: T, locale: Locale) {
  return dependencyPresentation(contribution, locale);
}

/** Project host diagnostics for display without changing dependency readiness or canonical data. */
export function pluginDiagnosticsPresentation<T extends InstallationDiagnostics>(installation: T, locale: Locale) {
  const {localizedActivationIssues, ...plainInstallation} = installation;
  const activationIssues = installation.activationIssues?.map((issue, index) => {
    const message = localizedActivationIssues && localizedActivationIssues.length === installation.activationIssues?.length
      ? readNativeMessage(localizedActivationIssues[index]) : null;
    return message ? translateMessage(locale, message) : issue;
  });
  return {...plainInstallation, ...(activationIssues ? {activationIssues} : {}),
    ...(installation.packageDependencies ? {packageDependencies:{...installation.packageDependencies,
      dependencies:installation.packageDependencies.dependencies.map(dependency => dependencyPresentation(dependency,locale))}} : {}),
    dependencies: installation.dependencies.map(dependency => dependencyPresentation(dependency,locale)),
  };
}
