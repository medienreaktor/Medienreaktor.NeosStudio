import { useState } from 'react'
import { asyncDataLoaderFeature, selectionFeature } from '@headless-tree/core'
import { useTree } from '@headless-tree/react'
import {
  DOCUMENT_NODE_TYPE,
  fetchChildren,
  fetchNode,
  useAnchoredContent,
} from '@/api/neos/endpoints/nodes'
import { useNodeTypes } from '@/api/neos/endpoints/nodeTypes'
import { siteNodeAddress } from '@/api/neos/endpoints/sites'
import type { Node, NodeAddress } from '@/api/neos/schema'
import { config } from '@/config'
import {
  Autocomplete,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxStatus,
} from '@/components/ui/combobox'
import { Placeholder } from '@/components/ui/placeholder'
import { useStudio } from '@/app/StudioContext'
import { useNodeDecorators } from '@/features/tree/decorators'
import { nodeDecor } from '@/features/tree/nodeDecor'
import { TreeList } from '@/features/tree/TreeList'
import { useAutoExpand } from '@/features/tree/useAutoExpand'
import { useRevealSelection } from '@/features/tree/useRevealSelection'
import { translate as t } from '@/lib/i18n'
import { documentAnchors, type DocumentAnchor } from '../documentAnchors'
import { documentUri, parseDocumentUri } from '../linkValue'
import type { LinkTypeTabProps } from '../registry'

/** Whether the anchor matches the typed text, by its label or the anchor itself. */
function anchorMatches(item: DocumentAnchor, query: string): boolean {
  const text = query.trim().toLowerCase()
  return (
    text === '' ||
    item.label.toLowerCase().includes(text) ||
    item.anchor.toLowerCase().includes(text)
  )
}

/** Virtual root above the site node, as in the document tree panel. */
const ROOT_ID = '__link_target_root__'

type TreeItemData = Node | typeof ROOT_ID

/**
 * "Link to a document": the site's document tree as a picker. Selecting a
 * document reports node://<aggregateId>; an existing document link is revealed
 * and highlighted. The optional anchor input appends a #fragment, so a link
 * can point at a section within the target page: it suggests the anchors of
 * the picked document's content (the links.anchors setting) and takes any
 * other text as well, warning - without refusing - when the picked document
 * has no such anchor.
 *
 * A read-only sibling of the DocumentTree panel: same data loading, eager
 * expansion and row decor, but no context menus or drag-and-drop - picking is
 * the only interaction. Like the document tree it shows one subgraph - the
 * active workspace in the selected document's dimension space point - so
 * item ids are node aggregate ids.
 */
export function DocumentLinkTab({ href, onChange }: LinkTypeTabProps) {
  const { site, workspaceName, selectedDocument } = useStudio()
  const { data: nodeTypes } = useNodeTypes()
  const decorators = useNodeDecorators()
  const parsed = href !== null ? parseDocumentUri(href) : null
  // The anchor is owned here (typing must not wait for a picked document);
  // the picked document travels through the href draft.
  const [anchor, setAnchor] = useState(() => parsed?.anchor ?? '')
  // Flips once the site node's children resolve (see DocumentTree).
  const [rootLoaded, setRootLoaded] = useState(false)

  const siteNode =
    site && workspaceName !== null
      ? siteNodeAddress(
          site,
          workspaceName,
          selectedDocument?.dimensionSpacePoint,
        )
      : null
  const addressOf = (nodeAggregateId: string): NodeAddress | null =>
    siteNode === null ? null : { ...siteNode, nodeAggregateId }

  const selectedAddress = parsed !== null ? addressOf(parsed.aggregateId) : null
  const anchoredContent = useAnchoredContent(
    selectedAddress,
    config.linkAnchors.property,
  )
  const anchors =
    anchoredContent.data !== undefined
      ? documentAnchors(anchoredContent.data, config.linkAnchors)
      : []
  const typedAnchor = anchor.trim()
  const anchorMissing =
    typedAnchor !== '' &&
    anchoredContent.isSuccess &&
    !anchors.some((item) => item.anchor === typedAnchor)

  const emit = (aggregateId: string | null, anchorText: string) => {
    onChange(
      aggregateId === null ? null : documentUri(aggregateId, anchorText.trim()),
    )
  }

  const tree = useTree<TreeItemData>({
    rootItemId: ROOT_ID,
    getItemName: (item) => {
      const data = item.getItemData()
      return data === ROOT_ID || data === null
        ? '…'
        : data.label || data.nodeAggregateId
    },
    isItemFolder: (item) => {
      const data = item.getItemData()
      if (data === ROOT_ID || data === null) return true
      return data.hasChildren ?? false
    },
    onPrimaryAction: (item) => {
      const data = item.getItemData()
      if (data !== ROOT_ID && data !== null) emit(data.nodeAggregateId, anchor)
    },
    dataLoader: {
      getItem: async (itemId): Promise<TreeItemData> => {
        if (itemId === ROOT_ID) return ROOT_ID
        const address = addressOf(itemId)
        if (address === null) throw new Error('No site node to pick from')
        return await fetchNode(address, DOCUMENT_NODE_TYPE)
      },
      getChildrenWithData: async (itemId) => {
        try {
          if (itemId === ROOT_ID) {
            if (siteNode === null) {
              setRootLoaded(true)
              return []
            }
            const node = await fetchNode(siteNode, DOCUMENT_NODE_TYPE)
            setRootLoaded(true)
            return [{ id: node.nodeAggregateId, data: node as TreeItemData }]
          }
          const address = addressOf(itemId)
          if (address === null) return []
          const children = await fetchChildren(address, DOCUMENT_NODE_TYPE)
          return children.map((node) => ({
            id: node.nodeAggregateId,
            data: node as TreeItemData,
          }))
        } catch {
          // A vanished node just yields no children - the picker stays usable.
          setRootLoaded(true)
          return []
        }
      },
    },
    features: [asyncDataLoaderFeature, selectionFeature],
  })

  useAutoExpand(tree, config.nodeTree.loadingDepth)
  useRevealSelection(tree, selectedAddress)

  if (!site) {
    return (
      <Placeholder
        icon="fa-sitemap"
        title={t(
          'link.noSite',
          'No site is active - there is no document tree to pick from.',
        )}
        className="p-3"
      />
    )
  }

  return (
    // TabsContent carries no padding (the media tab is edge-to-edge), so
    // every tab brings its own p-3.
    <div className="flex h-full min-h-0 flex-col gap-2 p-3">
      <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-divider bg-background p-1">
        <TreeList
          tree={tree}
          label={t('link.targetDocument', 'Link target document')}
          loading={!rootLoaded}
          loadingText={t('link.loadingDocuments', 'Loading documents…')}
          emptyText={t('link.noDocuments', 'This site has no documents yet.')}
          emptyIcon="fa-sitemap"
          decorate={(data) =>
            data === ROOT_ID || data === null
              ? null
              : nodeDecor(data, nodeTypes, null, [], decorators)
          }
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="flex items-center gap-2 type-small text-muted-foreground">
          <span className="shrink-0">{t('link.anchor', 'Anchor')}</span>
          <Autocomplete<DocumentAnchor>
            items={anchors}
            value={anchor}
            onValueChange={(next) => {
              setAnchor(next)
              emit(parsed?.aggregateId ?? null, next)
            }}
            itemToStringValue={(item) => item.anchor}
            filter={anchorMatches}
            openOnInputClick
          >
            <ComboboxInput
              placeholder={t(
                'link.anchorPlaceholder',
                'Optional #anchor on the target page',
              )}
              className="h-6.5 type-body"
            />
            <ComboboxContent>
              <ComboboxStatus>
                {anchoredContent.isLoading ? (
                  <>
                    <i
                      className="fas fa-spinner fa-spin type-icon-l"
                      aria-hidden
                    />
                    {t('link.loadingAnchors', 'Loading anchors…')}
                  </>
                ) : null}
              </ComboboxStatus>
              <ComboboxEmpty>
                {anchoredContent.isLoading || anchoredContent.isError
                  ? null
                  : parsed === null
                    ? t(
                        'link.anchorsPickDocument',
                        'Pick a document to see its anchors.',
                      )
                    : anchors.length === 0
                      ? t('link.noAnchors', 'This page has no anchors.')
                      : t('editor.noMatches', 'No matches')}
              </ComboboxEmpty>
              <ComboboxList>
                {(item: DocumentAnchor) => (
                  <ComboboxItem key={item.nodeAggregateId} value={item}>
                    <span className="min-w-0 flex-1 truncate">
                      {item.label}
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      #{item.anchor}
                    </span>
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Autocomplete>
        </label>
        {anchoredContent.isError ? (
          <p className="type-small text-destructive-text">
            {t(
              'link.anchorsFailed',
              'The anchors of this page could not be loaded - you can still type one.',
            )}
          </p>
        ) : anchorMissing ? (
          <p className="type-small text-warning-text">
            {t(
              'link.anchorMissing',
              'The selected page has no element with this anchor - the link will lead to the top of the page.',
            )}
          </p>
        ) : null}
      </div>
    </div>
  )
}
