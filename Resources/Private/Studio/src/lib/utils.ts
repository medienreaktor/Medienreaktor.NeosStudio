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
export const floatingControl = 'bg-card/80 backdrop-blur-xs'

/**
 * Companion backdrop for the toolbars holding floating controls: the panel
 * background fades in from transparent (bottom) to opaque (top), so content
 * scrolling underneath dims towards the panel edge without a full blur.
 */
export const toolbarFade = 'bg-gradient-to-t from-transparent to-background'
