import type { JsonValue } from './semantic.js';

/** Visual trees are presentation output, never capability or semantic contributions. */
export type PresentationNode = {
  tag: 'div' | 'section' | 'main' | 'aside' | 'header' | 'footer' | 'nav' | 'article'
    | 'h1' | 'h2' | 'h3' | 'p' | 'span' | 'strong' | 'em' | 'pre' | 'code'
    | 'ul' | 'ol' | 'li' | 'button' | 'input' | 'textarea' | 'label' | 'select' | 'option'
    | 'table' | 'thead' | 'tbody' | 'tr' | 'th' | 'td' | 'details' | 'summary' | 'hr'
    | 'img' | 'svg' | 'path' | 'circle' | 'rect' | 'line' | 'polyline' | 'polygon' | 'g';
  key: string;
  text?: string;
  className?: string;
  /** An image resource path declared by the package; arbitrary URLs are not accepted. */
  resource?: string;
  attrs?: Readonly<Record<string, string | boolean>>;
  /** User events become intents; only the host decides whether to execute them. */
  events?: Partial<Record<'click' | 'input' | 'change' | 'keydown', string>>;
  /** Presentation-owned interaction, delivered only to the package Worker. */
  localEvents?: Partial<Record<'click' | 'input' | 'change' | 'keydown', string>>;
  children?: readonly PresentationNode[];
};

export type PresentationContext = {
  workspaceId: string | null;
  sessionId: string | null;
  revision: number;
};
export type PresentationInput = {
  surface: 'controls' | 'semantic' | 'workbench';
  context: PresentationContext;
  data: JsonValue;
  theme: Readonly<Record<string, string>>;
};
export type PresentationIntent = {
  id: string;
  event?: 'click' | 'input' | 'change' | 'keydown';
  editSequence?: number;
  context: PresentationContext;
  value?: string;
  key?: string;
};
