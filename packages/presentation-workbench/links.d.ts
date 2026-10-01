export type LinkTarget = {kind:'web'|'email'} | {kind:'file';path:string;line:number|null;column:number|null};
export function linkTarget(href:string): LinkTarget|null;
export const linkIcons: {web:'globe';email:'mail';file:'file'};
export const linkLabels: Record<LinkTarget['kind'],string>;
export const linkIconPaths: Record<LinkTarget['kind'],string>;
