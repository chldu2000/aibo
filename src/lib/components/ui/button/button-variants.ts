import { tv, type VariantProps } from 'tailwind-variants';

export const buttonVariants = tv({
  base: 'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--aibo-focus)] disabled:pointer-events-none disabled:opacity-50',
  variants: {
    variant: {
      default:
        'border-[var(--aibo-accent-border)] bg-[var(--aibo-accent)] text-[var(--aibo-bg)] hover:bg-[var(--aibo-accent-hover)]',
      outline:
        'border-[var(--aibo-border-strong)] bg-transparent text-[var(--aibo-text)] hover:border-[var(--aibo-accent-border)] hover:bg-[var(--aibo-surface-hover)]',
      secondary:
        'border-transparent bg-[var(--aibo-surface-hover)] text-[var(--aibo-text)] hover:bg-[var(--aibo-border-strong)]',
      ghost:
        'border-transparent bg-transparent text-[var(--aibo-muted)] hover:bg-[var(--aibo-surface-hover)] hover:text-[var(--aibo-text)]',
      destructive:
        'border-[var(--aibo-danger-border)] bg-[var(--aibo-danger-surface)] text-[var(--aibo-danger-text)] hover:bg-[var(--aibo-danger-hover)]',
    },
    size: {
      default: 'h-8 px-3',
      sm: 'h-7 px-2.5 text-[11px]',
      icon: 'size-8',
    },
  },
  defaultVariants: {
    variant: 'default',
    size: 'default',
  },
});

export type ButtonVariant = VariantProps<typeof buttonVariants>['variant'];
export type ButtonSize = VariantProps<typeof buttonVariants>['size'];
