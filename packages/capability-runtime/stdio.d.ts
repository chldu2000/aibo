import type { CapabilityOptions } from './runtime.js';
export function serveCapability(options:CapabilityOptions):{close():void};

/** A generation binds one declared contribution; later initialization cannot switch it. */
export function serveCapabilities(contributions:CapabilityOptions[]):{close():void};
