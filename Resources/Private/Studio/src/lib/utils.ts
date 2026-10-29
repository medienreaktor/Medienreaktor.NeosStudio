import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * tailwind-merge knows Tailwind's own utilities, not the type-* text styles
 * generated from Figma (styles/texts.css). Registering them as one group lets
 * a className override replace the base text style instead of both landing in
 * the class list, where CSS source order would pick the winner.
 */
const twMerge = extendTailwindMerge<'type'>({
  extend: {
    classGroups: {
      type: [{ type: [(value: string) => /^[a-z0-9-]+$/.test(value)] }],
    },
  },
})

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
