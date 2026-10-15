import type { LinkAttributes } from '@/features/preview/protocol'

/**
 * The link model the Link Editor edits. The `href` is a Neos link URI exactly
 * as the backend stores it - node://<aggregateId>[#anchor] for documents,
 * asset://<uuid> for Media Library assets, or any absolute URI (https, mailto,
 * tel, ...). The other fields are the shared link options every link type
 * offers; whether they persist depends on the host: an inline rich-text link
 * carries them as attributes on the <a> tag, a string-typed node property can
 * only store the href.
 */
export interface LinkValue {
  href: string
  /** The link's target, e.g. '_blank'; null for the default (same window). */
  target: string | null
  /** rel tokens, e.g. 'nofollow'; null for none. */
  rel: string | null
  /** An additional CSS class for the rendered <a>; null for none. */
  cssClass: string | null
  /** The link's title attribute (tooltip); null for none. */
  title: string | null
}

const DOCUMENT_SCHEME = 'node://'
const ASSET_SCHEME = 'asset://'

export function isDocumentUri(href: string): boolean {
  return href.startsWith(DOCUMENT_SCHEME)
}

export function isAssetUri(href: string): boolean {
  return href.startsWith(ASSET_SCHEME)
}

export function documentUri(aggregateId: string, anchor = ''): string {
  return anchor
    ? `${DOCUMENT_SCHEME}${aggregateId}#${anchor}`
    : `${DOCUMENT_SCHEME}${aggregateId}`
}

export function assetUri(identifier: string): string {
  return `${ASSET_SCHEME}${identifier}`
}

/**
 * The parts of a document link URI (node://<aggregateId>[#anchor]), or null
 * for any other kind of href.
 */
export function parseDocumentUri(
  href: string,
): { aggregateId: string; anchor: string } | null {
  if (!isDocumentUri(href)) return null
  const rest = href.slice(DOCUMENT_SCHEME.length)
  const hash = rest.indexOf('#')
  if (hash === -1) return { aggregateId: rest, anchor: '' }
  return { aggregateId: rest.slice(0, hash), anchor: rest.slice(hash + 1) }
}

/** The asset identifier of an asset link URI, or null for any other href. */
export function parseAssetUri(href: string): string | null {
  return isAssetUri(href) ? href.slice(ASSET_SCHEME.length) : null
}

/**
 * The schemes a link may use: web, mail and phone links, and the Neos link
 * URIs. Anything else - javascript:, data:, vbscript:, ... - could run script
 * in the rendered page and is refused.
 */
const ALLOWED_SCHEMES = new Set([
  'http',
  'https',
  'mailto',
  'tel',
  'node',
  'asset',
])

/** Whether the href starts with a scheme (e.g. "https:"), not a relative path. */
export function hasScheme(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href.trim())
}

/**
 * Whether the href may be stored as a link: one of the allowed schemes, or a
 * relative link (a path, query or anchor without scheme). Leading whitespace
 * and control characters - which browsers ignore before a scheme - do not
 * smuggle one past the check.
 */
export function isAllowedHref(href: string): boolean {
  // eslint-disable-next-line no-control-regex
  const cleaned = href.replace(/[\u0000-\u0020]/g, '')
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(cleaned)
  return scheme === null || ALLOWED_SCHEMES.has((scheme[1] ?? '').toLowerCase())
}

/** An inline link's DOM attributes (guest protocol) as a LinkValue. */
export function linkValueFromAttributes(attributes: LinkAttributes): LinkValue {
  return {
    href: attributes.href,
    target: attributes.target ?? null,
    rel: attributes.rel ?? null,
    cssClass: attributes.class ?? null,
    title: attributes.title ?? null,
  }
}

/** A LinkValue as the DOM attributes the guest applies to the link mark. */
export function linkAttributesFrom(value: LinkValue): LinkAttributes {
  return {
    href: value.href,
    target: value.target,
    rel: value.rel,
    class: value.cssClass,
    title: value.title,
  }
}
