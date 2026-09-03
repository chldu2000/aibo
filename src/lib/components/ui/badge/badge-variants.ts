import { tv, type VariantProps } from 'tailwind-variants';

export const badgeVariants = tv({
  base: 'inline-flex w-fit shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-medium leading-4 transition-colors',
  variants: {
    variant: {
      default:
        'border-transparent bg-[var(--aibo-accent-soft)] text-[var(--aibo-accent-text)]',
      secondary:
        'border-transparent bg-[var(--aibo-surface-hover)] text-[var(--aibo-muted)]',
      outline:
        'border-[var(--aibo-border-strong)] bg-transparent text-[var(--aibo-muted)]',
      success:
        'border-[var(--aibo-success-border)] bg-[var(--aibo-success-surface)] text-[var(--aibo-success-text)]',
      warning:
        'border-[var(--aibo-warning-border)] bg-[var(--aibo-warning-surface)] text-[var(--aibo-warning-text)]',
      destructive:
        'border-[var(--aibo-danger-border)] bg-[var(--aibo-danger-surface)] text-[var(--aibo-danger-text)]',
    },
  },
  defaultVariants: { variant: 'default' },
});

export type BadgeVariant = VariantProps<typeof badgeVariants>['variant'];
