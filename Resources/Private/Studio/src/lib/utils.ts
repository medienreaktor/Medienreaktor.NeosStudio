import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Surface for controls floating over scrollable content (the panel toolbars'
 * search fields, filter buttons and selects): the control itself carries the
 * translucent background + blur, not its container, so the content stays
 * visible between the controls.
 */
export const floatingControl =
  'bg-neutral-50/80 dark:bg-neutral-900/80 backdrop-blur-xs'
