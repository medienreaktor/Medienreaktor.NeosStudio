import { useRef, useState } from 'react'
import {
  asyncDataLoaderFeature,
  selectionFeature,
  type ItemInstance,
  type TreeInstance,
} from '@headless-tree/core'
import { useTree } from '@headless-tree/react'

import type { NodeTreeRule } from '@/api/accessRoles'
import {
  DOCUMENT_NODE_TYPE,
  fetchChildren,
  fetchNode,
  nodeLabel,
  type NodeDto,
} from '@/api/nodes'
import { useNodeTypes } from '@/api/nodeTypes'
import type { Site } from '@/api/sites'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Placeholder } from '@/components/ui/placeholder'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { NodeTypeIcon } from '@/features/tree/nodeTypeIcon'
import { TreeList } from '@/features/tree/TreeList'
import { useAutoExpand } from '@/features/tree/useAutoExpand'
import { translate as t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/** Virtual root above the site node, as in the document tree panel. */
const ROOT_ID = '__acl_tree_root__'

type TreeItemData = NodeDto | typeof ROOT_ID

/**
 * The page-tree restriction editor: browse a site, pick a document, allow or
 * deny it.
 *
 * Selection-then-action rather than per-row buttons. Tree rows are buttons
 * themselves, so controls inside them would be buttons inside a button -
 * invalid markup and a keyboard trap. Selecting a row and acting on it from
 * the bar underneath keeps rows honest and, as a bonus, makes the rule a
 * deliberate second step rather than something a stray click can do.
 *
 * Rows carry a marker for their own rule (+ allowed / − denied); the rule list
 * underneath is the authoritative view, since a branch collapsed out of sight
 * would otherwise hide what the role does.
 */
export function NodeTreeRuleEditor({
  sites,
  rules,
  onChange,
}: {
  /** Sites to browse; the caller narrows this to the role's allowed sites. */
  sites: Site[]
  rules: NodeTreeRule[]
  onChange: (rules: NodeTreeRule[]) => void
}) {
  const [siteNodeName, setSiteNodeName] = useState<string | null>(
    sites[0]?.nodeName ?? null,
  )
  const [selection, setSelection] = useState<{
    node: NodeDto
    path: string
  } | null>(null)
  const [includeDescendants, setIncludeDescendants] = useState(true)

  const site =
    sites.find((candidate) => candidate.nodeName === siteNodeName) ??
    sites[0] ??
    null

  const setRule = (mode: 'ALLOW' | 'DENY') => {
    if (!selection || !site) return
    const next = rules.filter(
      (rule) => rule.nodeAggregateId !== selection.node.aggregateId,
    )
    next.push({
      mode,
      siteNodeName: site.nodeName,
      nodeAggregateId: selection.node.aggregateId,
      label: nodeLabel(selection.node),
      path: selection.path,
      includeDescendants,
    })
    onChange(next)
  }

  const removeRule = (nodeAggregateId: string) => {
    onChange(rules.filter((rule) => rule.nodeAggregateId !== nodeAggregateId))
  }

  const selectedRule =
    selection !== null
      ? (rules.find(
          (rule) => rule.nodeAggregateId === selection.node.aggregateId,
        ) ?? null)
      : null

  if (sites.length === 0) {
    return (
      <Placeholder
        icon="fa-sitemap"
        title={t(
          'accessRoles.treeNoSites',
          'No site to browse — every site is excluded by the Sites tab.',
        )}
        className="py-10"
      />
    )
  }

  const siteItems = sites.map((candidate) => ({
    value: candidate.nodeName,
    label: candidate.name,
  }))

  return (
    <div className="space-y-3">
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        {t(
          'accessRoles.treeHint',
          'Without a rule the whole page tree is open. Add an allow rule and everything outside it closes; add deny rules to cut single pages out of a branch. The nearest rule to a page wins.',
        )}
      </p>

      {sites.length > 1 && (
        <Select
          value={site?.nodeName ?? null}
          onValueChange={(value) => {
            setSiteNodeName(String(value))
            setSelection(null)
          }}
          items={siteItems}
        >
          <SelectTrigger className="w-full max-w-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {siteItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {site?.nodeAddress ? (
        <SiteDocumentTree
          // Remounting on a site switch is the whole reset: the async loader
          // caches per tree instance, so reusing it would show the previous
          // site's rows until every branch refetched.
          key={site.nodeAddress}
          siteNodeAddress={site.nodeAddress}
          rules={rules}
          onSelect={(node, path) => setSelection({ node, path })}
        />
      ) : (
        <Placeholder
          icon="fa-triangle-exclamation"
          title={t(
            'accessRoles.treeSiteUnavailable',
            'This site has no node in the live workspace.',
          )}
          className="py-10"
        />
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed p-3">
        <span className="min-w-0 flex-1 truncate text-sm">
          {selection ? (
            <>
              <span className="text-neutral-500">
                {t('accessRoles.treeSelected', 'Selected:')}{' '}
              </span>
              <span className="font-medium text-neutral-950 dark:text-white">
                {selection.path}
              </span>
            </>
          ) : (
            <span className="text-neutral-500">
              {t(
                'accessRoles.treeSelectFirst',
                'Select a page above to allow or deny it.',
              )}
            </span>
          )}
        </span>

        <label className="flex cursor-pointer items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
          <Checkbox
            checked={includeDescendants}
            onCheckedChange={(checked) =>
              setIncludeDescendants(checked === true)
            }
          />
          {t('accessRoles.treeIncludeDescendants', 'Include sub-pages')}
        </label>

        <Button
          size="xs"
          variant="secondary"
          disabled={selection === null}
          onClick={() => setRule('ALLOW')}
        >
          <i className="fas fa-check" aria-hidden />
          {t('accessRoles.treeAllow', 'Allow')}
        </Button>
        <Button
          size="xs"
          variant="secondary"
          disabled={selection === null}
          onClick={() => setRule('DENY')}
        >
          <i className="fas fa-ban" aria-hidden />
          {t('accessRoles.treeDeny', 'Deny')}
        </Button>
        <Button
          size="xs"
          variant="ghost"
          disabled={selectedRule === null}
          onClick={() => selection && removeRule(selection.node.aggregateId)}
        >
          {t('accessRoles.treeClear', 'Clear')}
        </Button>
      </div>

      {rules.length > 0 && (
        <ul className="space-y-1">
          {rules.map((rule) => (
            <li
              key={rule.nodeAggregateId}
              className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-sm"
            >
              <span className="flex min-w-0 items-center gap-2">
                <i
                  className={cn(
                    'fas text-xs',
                    rule.mode === 'ALLOW'
                      ? 'fa-check text-green-600 dark:text-green-500'
                      : 'fa-ban text-red-600 dark:text-red-500',
                  )}
                  aria-hidden
                />
                <span className="truncate text-neutral-800 dark:text-neutral-200">
                  {rule.path || rule.label || rule.nodeAggregateId}
                </span>
                {!rule.includeDescendants && (
                  <Badge variant="outline">
                    {t('accessRoles.treeOnlyThisPage', 'This page only')}
                  </Badge>
                )}
                {rule.siteNodeName !== site?.nodeName && (
                  <Badge variant="secondary">{rule.siteNodeName}</Badge>
                )}
              </span>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={t('accessRoles.treeRemoveRule', 'Remove rule')}
                onClick={() => removeRule(rule.nodeAggregateId)}
              >
                <i className="fas fa-xmark" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SiteDocumentTree({
  siteNodeAddress,
  rules,
  onSelect,
}: {
  siteNodeAddress: string
  rules: NodeTreeRule[]
  onSelect: (node: NodeDto, path: string) => void
}) {
  const { data: nodeTypes } = useNodeTypes()
  // Flips once the site node's children resolve (see DocumentTree).
  const [rootLoaded, setRootLoaded] = useState(false)
  // The tree instance is not in scope inside its own configuration, and the
  // path of a selected row can only be read from the rendered item list.
  const treeRef = useRef<TreeInstance<TreeItemData> | null>(null)

  const tree = useTree<TreeItemData>({
    rootItemId: ROOT_ID,
    getItemName: (item) => {
      const data = item.getItemData()
      return data === ROOT_ID || data === null ? '…' : nodeLabel(data)
    },
    isItemFolder: (item) => {
      const data = item.getItemData()
      if (data === ROOT_ID || data === null) return true
      return data.hasChildren
    },
    onPrimaryAction: (item) => {
      const data = item.getItemData()
      if (data === ROOT_ID || data === null) return
      onSelect(data, pathOfItem(treeRef.current, item))
    },
    dataLoader: {
      getItem: async (itemId): Promise<TreeItemData> => {
        if (itemId === ROOT_ID) return ROOT_ID
        return await fetchNode(itemId, DOCUMENT_NODE_TYPE)
      },
      getChildrenWithData: async (itemId) => {
        try {
          if (itemId === ROOT_ID) {
            const siteNode = await fetchNode(
              siteNodeAddress,
              DOCUMENT_NODE_TYPE,
            )
            setRootLoaded(true)
            return [{ id: siteNode.address, data: siteNode as TreeItemData }]
          }
          const children = await fetchChildren(itemId, DOCUMENT_NODE_TYPE)
          return children.map((node) => ({
            id: node.address,
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
  treeRef.current = tree

  useAutoExpand(tree, 1)

  const ruleFor = (aggregateId: string) =>
    rules.find((rule) => rule.nodeAggregateId === aggregateId) ?? null

  return (
    <div className="h-64 min-h-0 overflow-y-auto rounded-md border bg-white p-1 dark:bg-neutral-950">
      <TreeList
        tree={tree}
        label={t('accessRoles.treeLabel', 'Page tree')}
        loading={!rootLoaded}
        loadingText={t('accessRoles.treeLoading', 'Loading pages…')}
        emptyText={t('accessRoles.treeEmpty', 'This site has no pages yet.')}
        emptyIcon="fa-sitemap"
        decorate={(data) => {
          if (data === ROOT_ID || data === null) return null
          const rule = ruleFor(data.aggregateId)
          return {
            icon: (
              <NodeTypeIcon
                nodeTypes={nodeTypes}
                nodeTypeName={data.nodeType}
              />
            ),
            markers: rule && (
              <i
                className={cn(
                  'fas text-[0.7rem]',
                  rule.mode === 'ALLOW'
                    ? 'fa-check text-green-600 dark:text-green-500'
                    : 'fa-ban text-red-600 dark:text-red-500',
                )}
                title={
                  rule.includeDescendants
                    ? t(
                        'accessRoles.treeRuleBranch',
                        'Rule applies to this page and everything below',
                      )
                    : t(
                        'accessRoles.treeRulePage',
                        'Rule applies to this page only',
                      )
                }
                aria-hidden
              />
            ),
          }
        }}
      />
    </div>
  )
}

/**
 * The breadcrumb of a rendered row ("Home / Products / Pumps"), read off the
 * flat item list: every ancestor of a visible row is itself visible, so
 * walking backwards and taking each first-seen shallower level reconstructs
 * the chain without touching the tree's internals.
 */
function pathOfItem(
  tree: TreeInstance<TreeItemData> | null,
  item: ItemInstance<TreeItemData>,
): string {
  if (!tree) return item.getItemName()
  const items = tree.getItems()
  const index = items.findIndex(
    (candidate) => candidate.getId() === item.getId(),
  )
  if (index === -1) return item.getItemName()

  const labels = [items[index].getItemName()]
  let level = items[index].getItemMeta().level
  for (let i = index - 1; i >= 0 && level > 0; i--) {
    const candidateLevel = items[i].getItemMeta().level
    if (candidateLevel < level) {
      labels.unshift(items[i].getItemName())
      level = candidateLevel
    }
  }

  return labels.join(' / ')
}
