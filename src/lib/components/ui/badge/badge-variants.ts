import { tv, type VariantProps } from 'tailwind-variants';

// Variants are semantic hooks. Each registered kit owns their visual treatment.
export const badgeVariants = tv({ variants: { variant: {
  default: '', secondary: '', outline: '', success: '', warning: '', destructive: '',
} }, defaultVariants: { variant: 'default' } });
export type BadgeVariant = VariantProps<typeof badgeVariants>['variant'];
