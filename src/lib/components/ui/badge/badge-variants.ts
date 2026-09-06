import { tv, type VariantProps } from 'tailwind-variants';

export const badgeVariants = tv({
  base: 'inline-flex h-5 w-fit shrink-0 items-center gap-1 overflow-hidden whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium leading-4 outline-none transition-all focus-visible:border-[var(--ring)] focus-visible:ring-[3px] focus-visible:ring-[var(--ring)]/50 aria-invalid:border-[var(--destructive)] aria-invalid:ring-[3px] aria-invalid:ring-[var(--destructive)]/20 [&>svg]:size-3 [&>svg]:shrink-0',
  variants: {
    variant: {
      default:
        'border-transparent bg-[var(--accent)] text-[var(--accent-foreground)]',
      secondary:
        'border-transparent bg-[var(--secondary)] text-[var(--secondary-foreground)]',
      outline:
        'border-[var(--border)] bg-transparent text-[var(--muted-foreground)]',
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
