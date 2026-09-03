import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge local component classes with caller overrides. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
