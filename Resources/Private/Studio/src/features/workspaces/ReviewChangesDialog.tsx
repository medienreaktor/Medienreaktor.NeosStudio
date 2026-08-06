import { useEffect, useMemo, useState } from 'react'
import {
  useWorkspaceDocumentChanges,
  useWorkspaceDocumentDiff,
  type Workspace,
  type WorkspaceDocumentChange,
} from '@/api/workspaces'
import { useStudio } from '@/app/StudioContext'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { LoadingState } from '@/components/ui/spinner'
import { Placeholder } from '@/components/ui/placeholder'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { FaIcon } from '@/features/tree/nodeTypeIcon'
import { cn } from '@/lib/utils'
import { translate as t } from '@/lib/i18n'
import { ConflictResolutionDialog } from './ConflictResolutionDialog'
import { TONE_BG_CLASSES } from './historyLabels'
import { NodeDiff } from './StepDiff'
import { useWorkspacePublishing } from './useWorkspacePublishing'

/**
 * The change verbs a document row can carry, in display priority order. Their
 * fill comes from the shared tone palette, so a review badge and a history
 * step speak of the same change in the same color: additions green, removals
 * red, modifications (moved as well as edited) blue.
 */
const CHANGE_BADGES = [
  {
    key: 'created',
    label: 'New',
    labelKey: 'workspace.badge.new',
    icon: 'fa-plus',
    tone: 'add',
  },
  {
    key: 'deleted',
    label: 'Removed',
    labelKey: 'workspace.badge.removed',
    icon: 'fa-trash-can',
    tone: 'remove',
  },
  {
    key: 'moved',
    label: 'Moved',
    labelKey: 'workspace.badge.moved',
    icon: 'fa-arrows-up-down-left-right',
    tone: 'change',
  },
  {
    key: 'changed',
    label: 'Changed',
    labelKey: 'workspace.badge.changed',
    icon: 'fa-pen',
    tone: 'change',
  },
] as const

function ChangeBadges({ document }: { document: WorkspaceDocumentChange }) {
  return (
    <span className="flex flex-wrap gap-1">
      {CHANGE_BADGES.filter((badge) => document[badge.key]).map((badge) => (
        <span
          key={badge.key}
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-neutral-950 dark:text-white',
            TONE_BG_CLASSES[badge.tone],
          )}
        >
          <i
            className={`fas fa-fw ${badge.icon} text-[0.625rem]`}
            aria-hidden
          />
          {t(badge.labelKey, badge.label)}
        </span>
      ))}
    </span>
  )
}

/**
 * The expanded body of a document row: the document's NET diff against the
 * base workspace - one squashed block per changed node showing exactly what
 * publishing this document would apply. The chronological step-by-step view
 * lives in the Workspaces graph's history panel; the review context answers
 * "what will change", not "how did it happen".
 */
function DocumentDiff({
  workspaceName,
  documentId,
}: {
  workspaceName: string
  documentId: string
}) {
  const { data, isLoading, isError } = useWorkspaceDocumentDiff(
    workspaceName,
    documentId,
  )
  return (
    <div className="mt-1 mb-2 ml-14 flex flex-col gap-2 text-[11px]">
      {isLoading && (
        <div className="py-1 text-neutral-500">
          {t('workspaceHistory.loadingDiff', 'Loading changes…')}
        </div>
      )}
      {isError && (
        <div className="py-1 text-neutral-500">
          {t('workspaceHistory.diffFailed', 'The changes could not be loaded.')}
        </div>
      )}
      {data?.nodes.map((node) => (
        <NodeDiff
          key={`${node.nodeAggregateId}:${JSON.stringify(node.dimensions)}`}
          node={node}
        />
      ))}
      {data !== undefined && data.nodes.length === 0 && (
        <div className="text-neutral-500">
          {t('workspaceHistory.noDetails', 'No details available.')}
        </div>
      )}
    </div>
  )
}

/** "Live" for the root workspace, the title (or name) otherwise. */
function workspaceLabel(workspace: Workspace | undefined, name: string) {
  if (!workspace) return name
  return workspace.classification === 'ROOT'
    ? t('workspace.live', 'Live')
    : workspace.title || workspace.name
}

/**
 * Lists the changes a workspace has made on top of its base workspace, grouped
 * by the document (page) they belong to, and lets an editor publish or discard
 * a selection of documents. Scoped to the active site, the same way the
 * Publish button's count is, so the two always agree.
 *
 * Which workspace is under review is picked inside the dialog: the source
 * ("changes in") and target ("publishing to") selects cover every reviewable
 * pair the account can see. The content repository only knows changes of a
 * workspace relative to its base, so valid pairs are exactly workspace -> its
 * base: the target select filters the sources, and picking a target re-picks a
 * matching source. This is what makes a draft -> live review possible without
 * moving the editing context into the draft workspace.
 *
 * Granularity is the document: the content repository publishes/discards a
 * document's changes as a unit, which is what avoids the dependency conflicts
 * an arbitrary per-node selection would hit. A conflict against the base
 * surfaces the shared ConflictResolutionDialog.
 */
export function ReviewChangesDialog({
  workspaces,
  activeWorkspace,
  initialSourceName,
  open,
  onOpenChange,
  onNavigate,
  onPublished,
}: {
  /** Every workspace the account can read (the workspace list). */
  workspaces: Workspace[]
  /** The current editing context; the dialog opens on its changes. */
  activeWorkspace: Workspace
  /**
   * The source workspace the dialog opens on instead of the active one (e.g.
   * the Workspaces graph reviewing a right-clicked card). The user can still
   * re-pick any pair inside the dialog.
   */
  initialSourceName?: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * Show a document in its workspace - switches the editing context first
   * when the reviewed workspace is not the active one.
   */
  onNavigate: (address: string, workspaceName: string) => void
  /**
   * Called after a publish succeeded, with the published source workspace -
   * e.g. the Tasks board completing a task once its changes went out.
   */
  onPublished?: (sourceWorkspaceName: string) => void
}) {
  // Reviewable sources: everything with a base to publish to. The list only
  // contains readable workspaces, so no extra permission filter is needed.
  const sources = useMemo(
    () => workspaces.filter((w) => w.baseWorkspace !== null),
    [workspaces],
  )

  const [sourceName, setSourceName] = useState(activeWorkspace.name)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  /** Documents whose change details (diffs) are unfolded. */
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  // Every open starts fresh on the requested (or active) workspace - the
  // closed dialog does not carry a stale review over to the next one.
  useEffect(() => {
    if (open) {
      setSourceName(initialSourceName ?? activeWorkspace.name)
      setSelectedIds(new Set())
      setExpandedIds(new Set())
    }
  }, [open, activeWorkspace.name, initialSourceName])

  const source =
    sources.find((w) => w.name === sourceName) ??
    sources.find((w) => w.name === activeWorkspace.name) ??
    sources[0] ??
    null
  const targetName = source?.baseWorkspace ?? null

  // The targets on offer: every workspace that some readable source publishes
  // to. A base the account cannot read is still a valid target (publishing
  // needs write on it only at publish time) - it renders by name.
  const targetNames = useMemo(() => {
    const names = [...new Set(sources.map((w) => w.baseWorkspace!))]
    const label = (name: string) =>
      workspaceLabel(
        workspaces.find((w) => w.name === name),
        name,
      )
    // Live first, the rest alphabetically.
    return names.sort((a, b) => {
      const wsA = workspaces.find((w) => w.name === a)
      const wsB = workspaces.find((w) => w.name === b)
      if (wsA?.classification === 'ROOT') return -1
      if (wsB?.classification === 'ROOT') return 1
      return label(a).localeCompare(label(b))
    })
  }, [sources, workspaces])

  const sourcesForTarget = useMemo(
    () => sources.filter((w) => w.baseWorkspace === targetName),
    [sources, targetName],
  )

  const pickSource = (name: string) => {
    if (name === source?.name) return
    setSourceName(name)
    setSelectedIds(new Set())
    setExpandedIds(new Set())
  }

  const pickTarget = (name: string) => {
    if (name === targetName) return
    // Re-pick a source that publishes to the new target: the active workspace
    // if it matches, otherwise one that actually has something to review.
    const candidates = sources.filter((w) => w.baseWorkspace === name)
    const next =
      candidates.find((w) => w.name === activeWorkspace.name) ??
      candidates.find((w) => w.hasPublishableChanges) ??
      candidates[0]
    if (next) pickSource(next.name)
  }

  const { site, navigateToNode } = useStudio()
  // Fetch only while open; the query refreshes on publish/discard via the
  // workspaces invalidation the shared hook performs.
  const { data, isLoading } = useWorkspaceDocumentChanges(
    source?.name ?? null,
    open,
  )
  const { operation, resolve, pendingConflict, setPendingConflict } =
    useWorkspacePublishing(source?.name ?? '')

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Scope to the active site, mirroring the Publish button: the active site's
  // documents plus any whose site could not be resolved (never silently hide a
  // pending change).
  const siteId = site?.aggregateId ?? null
  const documents = useMemo(() => {
    const all = data?.documents ?? []
    return siteId
      ? all.filter(
          (d) => d.siteAggregateId === siteId || d.siteAggregateId === null,
        )
      : all
  }, [data, siteId])

  // A discard waiting for confirmation; the confirm dialog is open while true.
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  // Validate the selection against the current list so a published/discarded
  // (now absent) document never lingers as a phantom selection.
  const selected = useMemo(
    () => documents.filter((d) => selectedIds.has(d.documentAggregateId)),
    [documents, selectedIds],
  )
  const selectedCount = selected.length
  const allSelected = documents.length > 0 && selectedCount === documents.length

  const toggle = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const toggleAll = (checked: boolean) => {
    setSelectedIds(
      checked
        ? new Set(documents.map((d) => d.documentAggregateId))
        : new Set(),
    )
  }

  const run = (kind: 'publish' | 'discard') => {
    const ids = selected.map((d) => d.documentAggregateId)
    if (ids.length === 0 || !source) return
    const sourceWorkspaceName = source.name
    operation.mutate(
      { kind, filter: { documents: ids } },
      {
        onSuccess: () => {
          setSelectedIds(new Set())
          if (kind === 'publish') onPublished?.(sourceWorkspaceName)
        },
      },
    )
  }

  const busy = operation.isPending
  const reviewingActive = source?.name === activeWorkspace.name
  const canPublish = source?.permissions.publish ?? false
  // Discarding rewrites the reviewed workspace - needs write access on it (a
  // given for the active workspace, not for e.g. a draft reviewed as VIEWER).
  const canDiscard = source?.permissions.write ?? false
  // Navigating means showing the document in its workspace. Away from the
  // active context that is an editing-context switch, which only exists for
  // the own personal workspace and writable shared ones.
  const canNavigate =
    source !== null &&
    (reviewingActive ||
      source.classification === 'PERSONAL' ||
      (source.classification === 'SHARED' && source.permissions.write))
  const sourceLabel = workspaceLabel(source ?? undefined, source?.name ?? '')
  const targetLabel = targetName
    ? workspaceLabel(
        workspaces.find((w) => w.name === targetName),
        targetName,
      )
    : t('workspace.baseWorkspaceFallback', 'the base workspace')
  const publishDeniedHint = t(
    'workspace.publishDenied',
    'You are not allowed to publish to "{0}"',
    [targetLabel],
  )
  const discardDeniedHint = t(
    'workspace.review.noWriteAccess',
    'You are not allowed to change "{0}"',
    [sourceLabel],
  )

  const sourceItems = sourcesForTarget.map((w) => ({
    value: w.name,
    label: workspaceLabel(w, w.name),
  }))
  const targetItems = targetNames.map((name) => ({
    value: name,
    label: workspaceLabel(
      workspaces.find((w) => w.name === name),
      name,
    ),
  }))

  const goToDocument = (address: string) => {
    if (!source) return
    onOpenChange(false)
    if (reviewingActive) navigateToNode(address)
    else onNavigate(address, source.name)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
        <DialogContent size="xl" className="flex max-h-[90vh] flex-col">
          <DialogHeader>
            <DialogTitle>
              {t('workspace.reviewChanges', 'Review changes')}
            </DialogTitle>
            <DialogDescription>
              {t(
                'workspace.review.selectDescription',
                'Select documents to publish or discard.',
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-center gap-3 pb-3">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-neutral-600 dark:text-neutral-400">
                {t('workspace.review.sourceLabel', 'Changes in')}
              </span>
              <Select
                value={source?.name}
                onValueChange={(v) => pickSource(v as string)}
                disabled={busy}
                items={sourceItems}
              >
                <SelectTrigger size="sm" className="min-w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sourcesForTarget.map((w) => (
                    <SelectItem key={w.name} value={w.name}>
                      {workspaceLabel(w, w.name)}
                      {w.hasPublishableChanges && (
                        <span
                          className="size-1.5 rounded-full bg-amber-500"
                          title={t(
                            'workspace.review.hasChanges',
                            'Has pending changes',
                          )}
                        />
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <i
              className="fas fa-arrow-right mt-4 text-xs text-neutral-500"
              aria-hidden
            />
            <div className="flex flex-col gap-1">
              <span className="text-xs text-neutral-600 dark:text-neutral-400">
                {t('workspace.review.targetLabel', 'Publishing to')}
              </span>
              <Select
                value={targetName ?? undefined}
                onValueChange={(v) => pickTarget(v as string)}
                disabled={busy}
                items={targetItems}
              >
                <SelectTrigger size="sm" className="min-w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {targetItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {documents.length > 0 && (
            <label className="flex cursor-pointer items-center gap-2 border-b border-neutral-200 dark:border-neutral-800 pb-2 text-sm text-neutral-700 dark:text-neutral-300">
              <Checkbox
                checked={allSelected}
                indeterminate={selectedCount > 0 && !allSelected}
                onCheckedChange={toggleAll}
              />
              {selectedCount > 0
                ? t('workspace.review.selectedOf', '{0} of {1} selected', [
                    selectedCount,
                    documents.length,
                  ])
                : t('workspace.review.selectAll', 'Select all ({0})', [
                    documents.length,
                  ])}
            </label>
          )}

          <div className="-mx-1 flex-1 overflow-y-auto px-1">
            {isLoading ? (
              <LoadingState
                label={t('workspace.review.loading', 'Loading changes…')}
                className="py-8"
              />
            ) : documents.length === 0 ? (
              <Placeholder
                icon="fa-check"
                title={t('workspace.review.empty', 'No pending changes.')}
                className="py-8"
              />
            ) : (
              <ul className="flex flex-col gap-px">
                {documents.map((document) => {
                  const id = document.documentAggregateId
                  const isSelected = selectedIds.has(id)
                  const isExpanded = expandedIds.has(id)
                  const breadcrumb = document.breadcrumb.slice(0, -1)
                  return (
                    // The selected look of every other list in the Studio
                    // (trees, trash, clipboard): blue border on the lifted
                    // surface, transparent border at rest so nothing shifts.
                    // It sits on the whole item, so an unfolded document holds
                    // its node changes inside its own selection.
                    <li
                      key={id}
                      className={cn(
                        // Hovering the document row lifts the whole item, its
                        // unfolded changes included (has-, so reading the diff
                        // itself does not light the item up).
                        'rounded-sm border border-transparent transition-colors',
                        isSelected
                          ? 'border-blue-500 bg-neutral-200 dark:bg-neutral-800'
                          : 'has-[>label:hover]:bg-neutral-200 dark:has-[>label:hover]:bg-neutral-800',
                      )}
                    >
                      <label className="flex cursor-pointer items-start gap-2 rounded-sm px-2 py-1.5">
                        <Checkbox
                          className="mt-0.5"
                          checked={isSelected}
                          onCheckedChange={(checked) => toggle(id, checked)}
                        />
                        <FaIcon
                          icon={document.icon ?? 'fa-file'}
                          className={cn(
                            // The icon's own line box is shorter than the
                            // title's (12px glyph, 14px text), so it needs the
                            // difference to sit on the title's baseline.
                            'mt-1 shrink-0 text-neutral-950 dark:text-white',
                            document.hidden && 'opacity-50',
                          )}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span
                              className={cn(
                                'truncate text-sm',
                                document.hidden && 'opacity-50',
                              )}
                            >
                              {document.label}
                            </span>
                            {document.hidden && (
                              <i
                                className="fas fa-eye-slash text-xs text-neutral-500"
                                title={t('workspace.review.hidden', 'Hidden')}
                                aria-hidden
                              />
                            )}
                          </div>
                          {breadcrumb.length > 0 && (
                            <div className="truncate text-xs text-neutral-600 dark:text-neutral-400">
                              {breadcrumb.join(' › ')}
                            </div>
                          )}
                          <div className="mt-1 flex items-center gap-2">
                            <ChangeBadges document={document} />
                            <span className="text-xs text-neutral-500">
                              {document.changeCount === 1
                                ? t('workspace.oneChange', '1 change')
                                : t('workspace.manyChanges', '{0} changes', [
                                    document.changeCount,
                                  ])}
                            </span>
                          </div>
                        </div>
                        {document.documentAddress && canNavigate && (
                          <button
                            type="button"
                            className="mt-0.5 shrink-0 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                            title={
                              reviewingActive
                                ? t('workspace.review.goToPage', 'Go to page')
                                : t(
                                    'workspace.review.goToPageSwitches',
                                    'Go to page (switches the edited workspace)',
                                  )
                            }
                            onClick={(event) => {
                              // Don't toggle the row's checkbox.
                              event.preventDefault()
                              goToDocument(document.documentAddress!)
                            }}
                          >
                            <i
                              className="fas fa-fw fa-arrow-up-right-from-square"
                              aria-hidden
                            />
                          </button>
                        )}
                        <button
                          type="button"
                          className="mt-0.5 shrink-0 cursor-pointer text-xs"
                          title={
                            isExpanded
                              ? t(
                                  'workspace.review.hideChanges',
                                  'Hide changes',
                                )
                              : t(
                                  'workspace.review.showChanges',
                                  'Show changes',
                                )
                          }
                          onClick={(event) => {
                            // Don't toggle the row's checkbox.
                            event.preventDefault()
                            toggleExpanded(id)
                          }}
                        >
                          {/* The chevron of the inspector groups and the
                              history rows: same glyph, same rotation. */}
                          <i
                            className={cn(
                              'fas fa-chevron-right transition-transform',
                              isExpanded && 'rotate-90',
                            )}
                            aria-hidden
                          />
                        </button>
                      </label>
                      {isExpanded && source && (
                        <DocumentDiff
                          workspaceName={source.name}
                          documentId={id}
                        />
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <DialogFooter className="border-t border-neutral-200 dark:border-neutral-800 pt-4">
            <Button
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              {t('action.close', 'Close')}
            </Button>
            <Button
              variant="destructive"
              disabled={selectedCount === 0 || !canDiscard || busy}
              title={canDiscard ? undefined : discardDeniedHint}
              onClick={() => setConfirmDiscard(true)}
            >
              <i className="fas fa-fw fa-trash-can" aria-hidden />
              {t('workspace.review.discardSelected', 'Discard selected')}
            </Button>
            <Button
              disabled={selectedCount === 0 || !canPublish || busy}
              title={canPublish ? undefined : publishDeniedHint}
              className={
                selectedCount > 0 && canPublish
                  ? 'bg-green-500 text-white hover:bg-green-400 dark:hover:bg-green-600'
                  : undefined
              }
              onClick={() => run('publish')}
            >
              <i
                className={`fas fa-fw ${busy && operation.variables?.kind === 'publish' ? 'fa-spinner fa-spin' : 'fa-arrow-up-from-bracket'}`}
                aria-hidden
              />
              {selectedCount > 0
                ? t(
                    'workspace.review.publishSelectedCount',
                    'Publish selected ({0})',
                    [selectedCount],
                  )
                : t('workspace.review.publishSelected', 'Publish selected')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmDiscard}
        onOpenChange={(next) => !next && setConfirmDiscard(false)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selectedCount === 1
                ? t(
                    'workspace.review.discardOneTitle',
                    'Discard changes on this document?',
                  )
                : t(
                    'workspace.review.discardManyTitle',
                    'Discard changes on {0} documents?',
                    [selectedCount],
                  )}
            </DialogTitle>
            <DialogDescription>
              {selectedCount === 1
                ? t(
                    'workspace.review.discardOneBody',
                    'The pending changes on the selected document will be discarded. This cannot be undone.',
                  )
                : t(
                    'workspace.review.discardManyBody',
                    'The pending changes on the selected documents will be discarded. This cannot be undone.',
                  )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => setConfirmDiscard(false)}
            >
              {t('action.cancel', 'Cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmDiscard(false)
                run('discard')
              }}
            >
              {t('workspace.discard.button', 'Discard')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConflictResolutionDialog
        open={pendingConflict !== null}
        conflicts={pendingConflict?.conflicts.conflicts ?? []}
        partial={
          pendingConflict?.conflicts.code === 'partial_publish_conflicts'
        }
        busy={resolve.isPending}
        onCancel={() => setPendingConflict(null)}
        onForce={() => resolve.mutate('force')}
        onDiscardAll={() => resolve.mutate('discardAll')}
        onNavigate={(address) => {
          setPendingConflict(null)
          goToDocument(address)
        }}
      />
    </>
  )
}
