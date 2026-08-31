import confetti from 'canvas-confetti'

import { config } from '@/config'

/**
 * Celebratory confetti burst centered on an element. canvas-confetti draws
 * on its own fixed full-screen canvas, so the origin has to be the element's
 * center in viewport-relative coordinates. The anchor sits in the top-right
 * corner, so instead of the library's straight-up default (which would leave
 * the viewport immediately) the burst is angled leftward across the screen
 * and rains down from there. Skips itself entirely where the operator turned
 * the celebration off (the publishCelebration setting, mirrored into the boot
 * config) and for users who prefer reduced motion.
 */
export function celebrateAround(anchor: HTMLElement | null) {
  if (!anchor || !config.publishCelebration) return
  const rect = anchor.getBoundingClientRect()
  const origin = {
    x: (rect.left + rect.width / 2) / window.innerWidth,
    y: (rect.top + rect.height / 2) / window.innerHeight,
  }
  // angle 180 = straight left, slightly below keeps the arc on screen.
  void confetti({
    origin,
    particleCount: 120,
    angle: 190,
    spread: 70,
    startVelocity: 55,
    disableForReducedMotion: true,
    // Above the topbar and any open dialog/popover (Tailwind z-50 tiers).
    zIndex: 1000,
  })
}
