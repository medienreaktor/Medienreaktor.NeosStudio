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

/** Why a typed external link can't be stored. */
export type ExternalHrefError =
  /** Nothing typed yet - not a mistake, just nothing to apply. */
  | { kind: 'empty' }
  /** A space, tab or line break inside the address. */
  | { kind: 'whitespace' }
  /** A scheme right behind the first one - "https://https://...", "https://node://...". */
  | { kind: 'second_scheme' }
  /** A scheme outside the allowed ones (javascript:, data:, ...), see isAllowedHref. */
  | { kind: 'scheme_not_allowed' }
  /** Something the URL parser rejects, e.g. "https://" alone. */
  | { kind: 'unparsable' }

export type ExternalHrefResult =
  { ok: true; href: string } | { ok: false; error: ExternalHrefError }

/** A relative link: a path, query or anchor without scheme. */
const RELATIVE = /^[/?#.]/

/**
 * A scheme following the first one: either any scheme with "//" or one of the
 * allowed schemes (node:, mailto:, ...). Credentials ("https://user:pw@host")
 * have neither, and a URL further down the query ("?to=https://...") is not
 * right behind the first scheme.
 */
const SECOND_SCHEME = new RegExp(
  `^[a-z][a-z0-9+.-]*:(?://)?(?:[a-z][a-z0-9+.-]*://|(?:${[...ALLOWED_SCHEMES].join('|')}):)`,
  'i',
)

/** Only resolves relative links for the parse check, never stored. */
const PARSE_BASE = 'https://example.invalid/'

/**
 * The href a typed external link is stored as. A URL without a scheme gets
 * https:// - "example.com" is what people type, "https://example.com" is what
 * the link must store. Links with a scheme (https:, mailto:, tel:, ...) and
 * relative links (/path, ?query, #anchor, ./file) stay as typed. Refused are
 * whitespace inside the address, a second scheme right behind the first (a
 * pasted URL in front of another one), schemes that could run script (see
 * isAllowedHref) and anything the URL parser cannot read.
 */
export function parseExternalHref(raw: string): ExternalHrefResult {
  const typed = raw.trim()
  if (typed === '') return { ok: false, error: { kind: 'empty' } }
  const href =
    hasScheme(typed) || RELATIVE.test(typed) ? typed : `https://${typed}`
  // Checked without the whitespace, so "https:// https://x" reads as the
  // second scheme it is rather than as a stray space.
  if (SECOND_SCHEME.test(href.replace(/\s+/g, ''))) {
    return { ok: false, error: { kind: 'second_scheme' } }
  }
  if (/\s/.test(href)) return { ok: false, error: { kind: 'whitespace' } }
  if (!isAllowedHref(href)) {
    return { ok: false, error: { kind: 'scheme_not_allowed' } }
  }
  if (!URL.canParse(href, PARSE_BASE)) {
    return { ok: false, error: { kind: 'unparsable' } }
  }
  return { ok: true, href }
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
