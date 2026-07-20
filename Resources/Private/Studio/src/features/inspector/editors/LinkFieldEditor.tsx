import { useState } from 'react'

import { useAsset } from '@/api/media'
import { addressWithAggregateId } from '@/api/nodeAddress'
import { useNode } from '@/api/nodes'
import { useStudio } from '@/app/StudioContext'
import { Button } from '@/components/ui/button'
import { LinkEditorDialog } from '@/features/links/LinkEditorDialog'
import {
  parseAssetUri,
  parseDocumentUri,
  type LinkValue,
} from '@/features/links/linkValue'
import { linkEditorRegistry } from '@/features/links/registry'
import type { PropertyEditorComponent } from './registry'

export const LINK_EDITOR = 'Neos.Neos/Inspector/Editors/LinkEditor'

/**
 * A link property: stores a Neos link URI string (node://<aggregateId>,
 * asset://<uuid>, https://..., mailto:...) - the same value the classic UI's
 * LinkEditor writes, so existing content and Fusion rendering (ConvertUris)
 * work unchanged. Editing opens the Link Editor dialog; the field itself shows
 * the resolved target (document label, asset label, or the URI) behind the
 * matching link type's icon.
 *
 * A plain string can only hold the href, so the dialog's shared link options
 * (target, CSS class, ...) are not offered here - for a rendered link those
 * are the Fusion template's concern. Inline rich-text links do store them
 * (as <a> attributes; see the preview's link flow).
 */
export const LinkFieldEditor: PropertyEditorComponent = ({
  subject,
  value,
  onCommit,
  onChange,
  nodeAddress,
}) => {
  const stored = typeof value === 'string' && value !== '' ? value : null
  const [href, setHref] = useState(stored)
  const [open, setOpen] = useState(false)
  const { site } = useStudio()

  // Resolve what the link points at, for display. Document links resolve the
  // aggregate id against the edited node's own subgraph (workspace +
  // dimension); in the creation dialog - no node yet - the site's serves.
  const baseAddress = nodeAddress ?? site?.nodeAddress ?? null
  const documentLink = href !== null ? parseDocumentUri(href) : null
  const documentAddress =
    documentLink !== null && baseAddress !== null
      ? addressWithAggregateId(baseAddress, documentLink.aggregateId)
      : null
  const documentQuery = useNode(documentAddress ?? '', documentAddress !== null)
  const assetIdentifier = href !== null ? parseAssetUri(href) : null
  const assetQuery = useAsset('neos', assetIdentifier)

  const commit = (next: string | null) => {
    setHref(next)
    onCommit(next)
    onChange?.(next)
  }

  const label =
    documentLink !== null
      ? (documentQuery.data?.label ?? href) +
        (documentLink.anchor ? ` #${documentLink.anchor}` : '')
      : assetIdentifier !== null
        ? (assetQuery.data?.label ?? href)
        : href

  const icon = (href !== null && linkEditorRegistry.match(href)?.icon) || (
    <i className="fas fa-link" aria-hidden />
  )

  return (
    <>
      {href === null ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-neutral-700 bg-neutral-950 px-3 py-2.5 text-sm text-neutral-400 hover:border-neutral-500 hover:text-white"
        >
          <i className="fas fa-link text-[1rem]" aria-hidden />
          Set link…
        </button>
      ) : (
        <div className="flex items-center gap-2 rounded-md border border-neutral-700 bg-neutral-950 py-1 pr-1 pl-2.5">
          <span className="shrink-0 text-[1rem] text-neutral-400">{icon}</span>
          <span className="min-w-0 flex-1 truncate text-sm" title={href}>
            {label}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setOpen(true)}
            title="Edit link"
          >
            <i className="fas fa-pen" aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => commit(null)}
            title="Remove link"
          >
            <i className="fas fa-xmark" aria-hidden />
          </Button>
        </div>
      )}
      {open && (
        <LinkEditorDialog
          open
          onOpenChange={(next) => {
            if (!next) setOpen(false)
          }}
          subject={subject.label}
          value={href !== null ? plainLink(href) : null}
          withOptions={false}
          onApply={(next: LinkValue) => {
            commit(next.href)
            setOpen(false)
          }}
          onRemove={
            href !== null
              ? () => {
                  commit(null)
                  setOpen(false)
                }
              : undefined
          }
        />
      )}
    </>
  )
}

/** A stored href as a LinkValue - a string property carries no options. */
function plainLink(href: string): LinkValue {
  return { href, target: null, rel: null, cssClass: null, title: null }
}
