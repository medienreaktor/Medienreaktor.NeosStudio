import type * as React from 'react'
import { ObservableRegistry, useRegistry } from '@/lib/registry'

/**
 * The link type registry: each entry contributes one tab to the Link Editor
 * dialog (see LinkEditorDialog.tsx) - a way of producing an href. The built-in
 * types (document, asset, external URL, e-mail) register here exactly like a
 * third-party plugin would register a tab for its own link source (an external
 * DAM, a shop's product catalogue, ...).
 *
 * Built on the shared observable store (see lib/registry.ts), like the
 * property editor registry: register-replaces-by-id for idempotent HMR and
 * plugin reloads, and a stable snapshot for React.
 */

/** The props a link type tab receives from the Link Editor dialog. */
export interface LinkTypeTabProps {
  /**
   * The current href draft for this tab: the edited link's href when it
   * belongs to this type (matches() returned true), a draft the tab reported
   * earlier this session, or null when there is nothing yet. The tab seeds its
   * controls from it.
   */
  href: string | null
  /**
   * Report the tab's result. An href when the tab's state amounts to a
   * complete link (a picked document, a typed URL), null while it is
   * incomplete - the dialog's Apply button follows.
   */
  onChange: (href: string | null) => void
}

export interface LinkTypeDefinition {
  /**
   * Stable id, also the tab's identity. Third-party types should namespace
   * their own ids ('Vendor.Package/LinkTypes/Product').
   */
  id: string
  /** The tab's label. */
  label: string
  /** An icon rendered before the label (and to mark link values of this type). */
  icon?: React.ReactNode
  /** The tab's UI. */
  component: React.ComponentType<LinkTypeTabProps>
  /**
   * Whether an existing href belongs to this type - decides which tab an
   * edited link opens on, and which type's icon marks a stored value.
   */
  matches: (href: string) => boolean
  /**
   * The type hrefs fall back to when no type matches (the external-URL tab):
   * it can display any href verbatim for the user to correct. At most one
   * registered type should set this.
   */
  isFallback?: boolean
}

/** Link types (tabs) in registration order, plus href → type matching. */
export class LinkEditorRegistry extends ObservableRegistry<LinkTypeDefinition> {
  /**
   * The type an href belongs to: the first registered type that matches it,
   * the fallback type otherwise (or the first registered as a last resort).
   */
  match(href: string): LinkTypeDefinition | undefined {
    const types = this.getAll()
    return (
      types.find((type) => type.matches(href)) ??
      types.find((type) => type.isFallback) ??
      types[0]
    )
  }
}

export const linkEditorRegistry = new LinkEditorRegistry()

/**
 * Subscribe to the registry and read the registered link types, re-rendering
 * when the set changes (a plugin registering a type, HMR).
 */
export function useLinkTypes(): LinkTypeDefinition[] {
  return useRegistry(linkEditorRegistry)
}
