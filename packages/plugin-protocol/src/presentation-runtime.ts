import type { JsonValue } from './semantic.js';

/** Visual trees are presentation output, never capability or semantic contributions. */
export type PresentationNode = {
  tag: 'div' | 'section' | 'main' | 'aside' | 'header' | 'footer' | 'nav' | 'article'
    | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'p' | 'span' | 'strong' | 'em' | 'del' | 'blockquote' | 'pre' | 'code'
    | 'ul' | 'ol' | 'li' | 'button' | 'input' | 'textarea' | 'label' | 'select' | 'option'
    | 'table' | 'thead' | 'tbody' | 'tr' | 'th' | 'td' | 'details' | 'summary' | 'hr'
    | 'img' | 'svg' | 'path' | 'circle' | 'rect' | 'line' | 'polyline' | 'polygon' | 'g';
  key: string;
  text?: string;
  className?: string;
  /** Bounded size hint exposed to skin CSS as --presentation-inline-size. */
  inlineSize?: number;
  /** Button-only horizontal splitter bound to a host input token. */
  resize?: { token: string; value: number; min: number; max: number; direction: 1 | -1 };
  /** Package image path or attachment:<id> from the current conversation; arbitrary URLs are rejected. */
  resource?: string;
  attrs?: Readonly<Record<string, string | boolean>>;
  /** User events become intents; only the host decides whether to execute them. */
  events?: Partial<Record<'click' | 'input' | 'change' | 'keydown', string>>;
  /** Presentation-owned interaction, delivered only to the package Worker. */
  localEvents?: Partial<Record<'click' | 'input' | 'change' | 'keydown', string>>;
  /** Textarea-only primary-modifier Enter shortcut, using an existing host click token. */
  primaryEnter?: string;
  /** Opt into Enter submission and Shift/Ctrl+Enter newline; legacy shortcut behavior is the default. */
  submitOnEnter?: boolean;
  /** Textarea suggestion list; keys reference existing host-action buttons in listKey. */
  suggestions?: { listKey: string; keys: readonly string[]; confirmWithTab?: boolean; confirmWithPrimary?: boolean; categories?: readonly { key: string; options: readonly string[] }[] };
  children?: readonly PresentationNode[];
};

export type PresentationContext = {
  workspaceId: string | null;
  sessionId: string | null;
  revision: number;
};
export type PresentationInput = {
  /** Display language only; absent in legacy hosts (Chinese). Does not grant authority. */
  locale?: 'zh-CN' | 'en';
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
