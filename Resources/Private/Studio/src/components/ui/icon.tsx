import type * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * Icons are Font Awesome glyphs. Studio ships the free webfonts (solid,
 * regular, brands and the v4 shims, imported in main.tsx) because Neos
 * configures icons - node types, inspector tabs and groups, select box
 * values - as Font Awesome names, so every configured name renders verbatim,
 * including project-specific ones we could never enumerate in a mapping
 * table. The same set is what plugins get: the icon names of the Font Awesome
 * version the shell ships are part of the plugin contract.
 */

export type IconVariant = 'solid' | 'regular' | 'brands'

/** The type-icon-* text styles (styles/texts.css), smallest to largest. */
export type IconSize = 'xs' | 's' | 'm' | 'l' | 'xl' | '2xl' | '3xl'

// Spelled out rather than built from the size: Tailwind only generates the
// utilities it finds verbatim in the source.
const SIZE_CLASS: Record<IconSize, string> = {
  xs: 'type-icon-xs',
  s: 'type-icon-s',
  m: 'type-icon-m',
  l: 'type-icon-l',
  xl: 'type-icon-xl',
  '2xl': 'type-icon-2xl',
  '3xl': 'type-icon-3xl',
}

const VARIANT_CLASS: Record<IconVariant, string> = {
  solid: 'fas',
  regular: 'far',
  brands: 'fab',
}

/** Class tokens that pick the Font Awesome style rather than the glyph. */
const STYLE_TOKENS = new Set([
  'fa',
  'fas',
  'far',
  'fab',
  'fa-solid',
  'fa-regular',
  'fa-brands',
  'fa-classic',
])

/**
 * The Font Awesome class list for an icon name in any syntax Neos accepts for
 * ui.icon: a full class list ("fas fa-file", "fa-regular fa-clock"), the
 * legacy "icon-file" of the FA3/4 era, or a bare name with or without the
 * "fa-" prefix ("file", "fa-file"). Without a variant the name's own style
 * applies (solid unless it says otherwise); a variant replaces it.
 */
export function faClassName(configured: string, variant?: IconVariant): string {
  const icon = configured.trim()
  let classes: string
  // Full FA class list - use as-is. Only the standalone "fas" token maps to
  // "fa" - never a substring of another class ("fa-fast-forward" must stay
  // intact).
  if (icon.includes(' ')) classes = icon.replace(/\bfas\b/, 'fa')
  // Legacy Neos "icon-file" syntax - the v4 shims resolve the names.
  else if (icon.startsWith('icon-')) classes = `fa fa-${icon.slice(5)}`
  // Bare name with or without fa- prefix.
  else classes = icon.startsWith('fa-') ? `fa ${icon}` : `fa fa-${icon}`
  if (variant === undefined) return classes
  const glyph = classes.split(/\s+/).filter((token) => !STYLE_TOKENS.has(token))
  return [VARIANT_CLASS[variant], ...glyph].join(' ')
}

export interface IconProps extends Omit<React.ComponentProps<'i'>, 'children'> {
  /**
   * The Font Awesome icon name, in any syntax node type `ui.icon` accepts:
   * "clock", "fa-clock", "fas fa-clock", "icon-clock".
   */
  name: string
  /** Font Awesome style; replaces one the name carries. Defaults to solid. */
  variant?: IconVariant
  /** One of the shell's icon text styles (type-icon-*). Defaults to "m". */
  size?: IconSize
  /**
   * Accessible name. An icon without one is decorative and hidden from
   * assistive technology - give it one when nothing next to it says what it
   * means (an icon-only status, say).
   */
  label?: string
}

/** A Font Awesome icon, fixed-width and sized like the shell's own. */
export function Icon({
  name,
  variant,
  size = 'm',
  label,
  className,
  ...props
}: IconProps) {
  return (
    <i
      {...props}
      className={cn(
        faClassName(name, variant),
        'fa-fw',
        SIZE_CLASS[size],
        className,
      )}
      {...(label
        ? { role: 'img', 'aria-label': label }
        : { 'aria-hidden': true })}
    />
  )
}
