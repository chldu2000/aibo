import { tv, type VariantProps } from 'tailwind-variants';
import type { UiButtonVariant } from '$lib/ui-kit/contract';

export const buttonVariants = tv({
  base: 'group/button inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--radius)] border border-transparent text-sm font-medium transition-all outline-none focus-visible:border-[var(--ring)] focus-visible:ring-[3px] focus-visible:ring-[var(--ring)]/50 active:translate-y-px aria-invalid:border-[var(--destructive)] aria-invalid:ring-[3px] aria-invalid:ring-[var(--destructive)]/20 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-4',
  variants: {
    variant: {
      default:
        'bg-[var(--primary)] text-[var(--primary-foreground)] hover:bg-[var(--primary-hover)]',
      outline:
        'border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] shadow-sm hover:bg-[var(--muted)] hover:text-[var(--foreground)]',
      secondary:
        'border-transparent bg-[var(--secondary)] text-[var(--secondary-foreground)] hover:bg-[var(--secondary-hover)]',
      ghost:
        'border-transparent bg-transparent text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--accent-foreground)]',
      destructive:
        'bg-[var(--destructive-surface)] text-[var(--destructive)] hover:bg-[var(--destructive-hover)] hover:text-[var(--destructive-foreground)] focus-visible:border-[var(--destructive)] focus-visible:ring-[var(--destructive)]/30',
      toolbar:
        'border-transparent bg-transparent text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--accent-foreground)]',
      queue:
        'border-[var(--input)] bg-transparent text-[var(--foreground)] hover:border-[var(--ring)] hover:bg-[var(--accent)]',
      abort:
        'bg-[var(--destructive-surface)] text-[var(--destructive)] hover:bg-[var(--destructive-hover)] hover:text-[var(--destructive-foreground)] focus-visible:border-[var(--destructive)] focus-visible:ring-[var(--destructive)]/30',
      send:
        'border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)] hover:bg-[var(--primary-hover)]',
    },
    size: {
      default: 'h-9 px-2.5',
      sm: 'h-8 px-2.5 text-xs',
      icon: 'size-9',
    },
  },
  defaultVariants: {
    variant: 'default',
    size: 'default',
  },
});

export type ButtonVariant = UiButtonVariant;
export type ButtonSize = VariantProps<typeof buttonVariants>['size'];
