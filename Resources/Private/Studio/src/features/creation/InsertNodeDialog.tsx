import { useState } from 'react'
import {
  fetchChildren,
  nodeLabel,
  useAllowedChildNodeTypes,
  useNode,
  useNodeAncestors,
} from '@/api/nodes'
import { toast } from '@/components/ui/toast'
import { translate as t } from '@/lib/i18n'
import { CollapsibleGroup } from '@/components/ui/collapsible-group'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { SearchInput } from '@/components/ui/search-input'
import { LoadingState } from '@/components/ui/spinner'
import { Placeholder } from '@/components/ui/placeholder'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { NodeTypeIcon } from '@/features/tree/nodeTypeIcon'
import {
  type CreatableNodeTypeGroup,
  filterCreatableGroups,
  useCreatableNodeTypes,
} from './creatableNodeTypes'
import { CreateNodeFlow } from './NodeCreationDialog'
import type { CreateNodeRequest } from './createNode'

export type InsertMode = 'before' | 'inside' | 'after'

/**
 * What the insertion is relative to. Callers that know the parent (tree rows,
 * the guest's element handle) pass parentAddress - null marks a node that
 * must not get siblings (the site node). Callers that don't leave it
 * undefined; the dialog resolves it via the ancestors relation.
 */
export interface InsertRequest {
  referenceAddress: string
  parentAddress?: string | null
  defaultMode?: InsertMode
}

export type InsertRole = 'document' | 'content'

const ROLES: Record<
  InsertRole,
  { superTypes: string[]; noun: string; icon: string }
> = {
  document: {
    superTypes: ['Neos.Neos:Document'],
    noun: 'document',
    icon: 'fa-file',
  },
  content: {
    // Collections are not Content subtypes but can be user-creatable
    // (e.g. column containers); constraints still decide per position.
    superTypes: ['Neos.Neos:Content', 'Neos.Neos:ContentCollection'],
    noun: 'element',
    icon: 'fa-cube',
  },
}

const MODES: { mode: InsertMode; label: string; icon: string }[] = [
  { mode: 'before', label: 'Before', icon: 'fa-arrow-up-long' },
  { mode: 'inside', label: 'Inside', icon: 'fa-arrow-right-long' },
  { mode: 'after', label: 'After', icon: 'fa-arrow-down-long' },
]

/**
 * The "create a node here" dialog, the old UI's insertion flow: pick the
 * insertion mode (before/after the reference node, or inside it as the last
 * child), pick one of the node types the content model allows at that
 * position, then run the regular creation flow (ui.creationDialog + command).
 *
 * Constraints come from the server's allowed-child-node-types relation -
 * "inside" checks the reference node's own list, "before"/"after" check the
 * parent's. Modes without a single allowed creatable type are disabled.
 *
 * Render unconditionally with request null while closed; a non-null request
 * opens it (remounting per reference, so mode/filter state starts fresh).
 */
export function InsertNodeDialog({
  request,
  role,
  onCreated,
  onClose,
}: {
  request: InsertRequest | null
  role: InsertRole
  /** The node exists: its address, plus the creation request that made it. */
  onCreated: (address: string, creation: CreateNodeRequest) => void
  /** The dialog was dismissed. */
  onClose: () => void
}) {
  if (request === null) return null
  return (
    <OpenInsertNodeDialog
      key={request.referenceAddress}
      request={request}
      role={role}
      onCreated={onCreated}
      onClose={onClose}
    />
  )
}

function OpenInsertNodeDialog({
  request,
  role,
  onCreated,
  onClose,
}: {
  request: InsertRequest
  role: InsertRole
  onCreated: (address: string, creation: CreateNodeRequest) => void
  onClose: () => void
}) {
  const { superTypes } = ROLES[role]
  const noun =
    role === 'document'
      ? t('creation.nounDocument', 'document')
      : t('creation.nounElement', 'element')
  const [selectedMode, setSelectedMode] = useState<InsertMode>(
    request.defaultMode ?? 'inside',
  )
  const [filter, setFilter] = useState('')
  // Groups the user opened/closed by hand, overriding the configured default.
  const [toggled, setToggled] = useState<Record<string, boolean>>({})
  // The picked type's creation flow is running; the picker steps aside.
  const [creation, setCreation] = useState<CreateNodeRequest | null>(null)
  // An "after" pick is looking up the reference's next sibling.
  const [resolving, setResolving] = useState(false)

  const { data: reference } = useNode(request.referenceAddress)

  // The parent, for sibling insertion: as passed by the caller, or resolved
  // through the ancestors relation. A root parent (the sites node) means no
  // sibling creation - a sibling of the site would be a new site.
  const needsParentResolution = request.parentAddress === undefined
  const { data: ancestors } = useNodeAncestors(
    needsParentResolution ? request.referenceAddress : null,
  )
  const parentAddress: string | null | undefined = !needsParentResolution
    ? request.parentAddress
    : ancestors === undefined
      ? undefined // still resolving - sibling modes show as loading
      : ancestors[0] && ancestors[0].classification !== 'root'
        ? ancestors[0].address
        : null

  const { data: insideAllowed } = useAllowedChildNodeTypes(
    request.referenceAddress,
  )
  const { data: siblingAllowed } = useAllowedChildNodeTypes(
    parentAddress ?? null,
  )

  const creatable = useCreatableNodeTypes(superTypes)

  // The creatable groups per mode, cut down to the types allowed at that
  // insertion point; null while the lists load.
  const groupsFor = (mode: InsertMode): CreatableNodeTypeGroup[] | null => {
    const allowed =
      mode === 'inside'
        ? insideAllowed
        : parentAddress === null
          ? []
          : siblingAllowed
    if (creatable === null || allowed === undefined) return null
    const allowedSet = new Set(allowed)
    return filterCreatableGroups(creatable.groups, (nodeType) =>
      allowedSet.has(nodeType.name),
    )
  }
  const modeGroups: Record<InsertMode, CreatableNodeTypeGroup[] | null> = {
    before: groupsFor('before'),
    inside: groupsFor('inside'),
    after: groupsFor('after'),
  }
  // The selected mode, or - once its list resolved empty - the first usable
  // one, so the dialog opens on something creatable without an effect dance.
  const activeMode =
    (modeGroups[selectedMode]?.length ?? 0) > 0 ||
    modeGroups[selectedMode] === null
      ? selectedMode
      : (MODES.map(({ mode }) => mode).find(
          (mode) => (modeGroups[mode]?.length ?? 0) > 0,
        ) ?? selectedMode)

  const groups = modeGroups[activeMode]
  const query = filter.trim().toLowerCase()
  const visibleGroups =
    groups !== null && query !== ''
      ? filterCreatableGroups(
          groups,
          (nodeType) =>
            nodeType.label.toLowerCase().includes(query) ||
            nodeType.name.toLowerCase().includes(query),
        )
      : groups

  const pick = async (nodeTypeName: string) => {
    if (resolving) return
    let parent = request.referenceAddress
    let succeedingSibling: string | null = null
    if (activeMode !== 'inside') {
      if (!parentAddress) return
      parent = parentAddress
      if (activeMode === 'before') {
        succeedingSibling = request.referenceAddress
      } else {
        // "After" needs the reference's next sibling (null appends at the
        // end). Unfiltered children, so nodes of other roles between two
        // siblings don't shift the insertion point.
        setResolving(true)
        try {
          const siblings = await fetchChildren(parent)
          const index = siblings.findIndex(
            (node) => node.address === request.referenceAddress,
          )
          succeedingSibling =
            index >= 0 ? (siblings[index + 1]?.address ?? null) : null
        } catch (e) {
          toast.error(e, {
            title: t('creation.creatingFailed', 'Creating failed'),
          })
          return
        } finally {
          setResolving(false)
        }
      }
    }
    setCreation({
      nodeTypeName,
      parentAddress: parent,
      succeedingSiblingAddress: succeedingSibling,
    })
  }

  return (
    <>
      <Dialog
        open={creation === null}
        onOpenChange={(open) => !open && onClose()}
      >
        <DialogContent
          size="lg"
          className="@container flex max-h-[80vh] flex-col gap-3 overflow-hidden"
        >
          <DialogHeader>
            <DialogTitle>
              {t('creation.createNewNoun', 'Create new {0}', [noun])}
            </DialogTitle>
            <DialogDescription>
              {reference
                ? t('creation.relativeTo', 'Relative to “{0}”.', [
                    nodeLabel(reference),
                  ])
                : ' '}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-row gap-4">
            <ToggleGroup
              size="sm"
              value={[activeMode]}
              onValueChange={([value]) => {
                if (value) setSelectedMode(value as InsertMode)
              }}
              aria-label={t('creation.insertionPosition', 'Insertion position')}
            >
              {MODES.map(({ mode, label, icon }) => {
                const loading = modeGroups[mode] === null
                const available = (modeGroups[mode]?.length ?? 0) > 0
                return (
                  <ToggleGroupItem
                    key={mode}
                    value={mode}
                    disabled={!available && !loading}
                  >
                    <i className={`fas ${icon}`} aria-hidden />
                    {t(`creation.mode.${mode}`, label)}
                  </ToggleGroupItem>
                )
              })}
            </ToggleGroup>
            <SearchInput
              placeholder={t(
                'creation.filterNodeTypesPlaceholder',
                'Filter node types…',
              )}
              aria-label={t('creation.filterNodeTypes', 'Filter node types')}
              autoFocus={true}
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {visibleGroups === null ? (
              <LoadingState
                label={t('creation.loadingNodeTypes', 'Loading node types…')}
              />
            ) : visibleGroups.length === 0 ? (
              <Placeholder
                icon={query ? 'fa-magnifying-glass' : ROLES[role].icon}
                title={
                  query
                    ? t(
                        'creation.noNodeTypesMatch',
                        'No node types match the filter.',
                      )
                    : t(
                        'creation.noTypesHere',
                        'No {0} types can be created here.',
                        [noun],
                      )
                }
                className="py-10"
              />
            ) : (
              visibleGroups.map((group) => (
                <CollapsibleGroup
                  key={group.name}
                  label={group.label}
                  // While filtering every group with matches stays open; the
                  // default comes from the group's configured collapsed flag.
                  open={
                    query !== '' || !(toggled[group.name] ?? group.collapsed)
                  }
                  onOpenChange={(open) =>
                    setToggled((previous) => ({
                      ...previous,
                      [group.name]: !open,
                    }))
                  }
                >
                  <ul className="grid grid-cols-2 gap-1 @[24rem]:grid-cols-3 @[32rem]:grid-cols-4 @[40rem]:grid-cols-5 @[48rem]:grid-cols-6">
                    {group.nodeTypes.map((nodeType) => (
                      <li key={nodeType.name}>
                        <button
                          type="button"
                          disabled={resolving}
                          title={`${nodeType.label} (${nodeType.name})`}
                          className="flex h-20 w-full flex-col items-center justify-center gap-1.5 rounded border border-neutral-700 bg-neutral-800/40 px-2 pt-2 pb-1 text-center hover:bg-neutral-800 disabled:opacity-50"
                          onClick={() => void pick(nodeType.name)}
                        >
                          <NodeTypeIcon
                            nodeTypes={creatable?.nodeTypes}
                            nodeTypeName={nodeType.name}
                            className="text-base"
                          />
                          <span className="line-clamp-2 w-full wrap-break-word text-xs leading-tight">
                            {nodeType.label}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </CollapsibleGroup>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      {creation && (
        <CreateNodeFlow
          request={creation}
          nodeTypes={creatable?.nodeTypes}
          onCreated={(address) => onCreated(address, creation)}
          onCancel={(error) => {
            // Cancelling the creation form returns to the type selection; a
            // failure without a visible form surfaces here as well.
            if (error)
              toast.error(error, {
                title: t('creation.creatingFailed', 'Creating failed'),
              })
            setCreation(null)
          }}
        />
      )}
    </>
  )
}
