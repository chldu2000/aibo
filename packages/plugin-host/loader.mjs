// Only public SDK exports resolve here. This is an API boundary, not a sandbox.
let sdk;
const prefix = 'aibo-sdk:///';
export function initialize(data) { sdk = data; }

export function resolve(specifier, context, nextResolve) {
  if (Object.hasOwn(sdk.exports, specifier)) {
    return { url: prefix + sdk.exports[specifier], shortCircuit: true };
  }
  if (context.parentURL?.startsWith(prefix) && specifier.startsWith('./')) {
    const url = new URL(specifier, context.parentURL).href;
    if (Object.hasOwn(sdk.modules, url.slice(prefix.length))) return { url, shortCircuit: true };
  }
  if (specifier.startsWith('@aibo/') || specifier.startsWith('aibo-sdk:')) {
    throw Object.assign(new Error(`Aibo SDK does not expose ${specifier}`), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
  }
  return nextResolve(specifier, context);
}

export function load(url, context, nextLoad) {
  if (url.startsWith(prefix) && Object.hasOwn(sdk.modules, url.slice(prefix.length))) {
    return { format: 'module', source: sdk.modules[url.slice(prefix.length)], shortCircuit: true };
  }
  return nextLoad(url, context);
}
