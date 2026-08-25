import { useEffect, useMemo, useState } from 'react'
import { groupComments, useReviewComments } from '@/api/reviewComments'
import {
  useWorkspaceDocumentChanges,
  useWorkspaceDocumentDiff,
  type Workspace,
} from '@/api/workspaces'
import { useStudio } from '@/app/StudioContext'
import { toast } from '@/components/ui/toast'
import { CommentThread } from '@/features/review/CommentThread'
import { RequestChangesDialog } from '@/features/review/RequestChangesDialog'
import { useTaskVerdict } from '@/features/review/useTaskVerdict'
import { taskStatusColor, taskStatusLabel } from '@/features/tasks/status'
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
import { CompareDialog } from '@/features/compare/CompareDialog'
import { FaIcon } from '@/features/tree/nodeTypeIcon'
import { cn } from '@/lib/utils'
import { translate as t } from '@/lib/i18n'
import { ChangeBadges, workspaceLabel } from './changeDisplay'
import { ConflictResolutionDialog } from './ConflictResolutionDialog'
import { NodeDiff } from './StepDiff'
import { useWorkspacePublishing } from './useWorkspacePublishing'

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
  initialCompareDocumentId,
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
  /**
   * Open the side-by-side comparison on this page right away - what a remark
   * notification leads to, since the remark is about a change on that page.
   */
  initialCompareDocumentId?: string
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
  /**
   * The document the side-by-side compare view opened on; null while it is
   * closed. The list here answers "what changed", the compare view answers
   * "does it look right" - so it opens from a row and takes the whole screen.
   */
  const [compareDocumentId, setCompareDocumentId] = useState<string | null>(
    null,
  )
  /** The conversation panel next to the list; open when there is one. */
  const [showComments, setShowComments] = useState(false)
  /** Handing the task back, with the reason the reviewer is about to write. */
  const [requestingChanges, setRequestingChanges] = useState(false)

  // Every open starts fresh on the requested (or active) workspace - the
  // closed dialog does not carry a stale review over to the next one.
  useEffect(() => {
    if (open) {
      setSourceName(initialSourceName ?? activeWorkspace.name)
      setSelectedIds(new Set())
      setExpandedIds(new Set())
      setCompareDocumentId(initialCompareDocumentId ?? null)
      setRequestingChanges(false)
    }
  }, [open, activeWorkspace.name, initialSourceName, initialCompareDocumentId])

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
    setCompareDocumentId(null)
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

  // The task behind the reviewed workspace, if it is a task branch at all.
  // It rides on the workspace object (the enricher's contribution), so having
  // the workflow here costs no extra request - and a plain shared draft simply
  // has none, which is what leaves its review a publish/discard decision.
  const verdict = useTaskVerdict(source)
  const task = verdict.task

  const { data: commentsData } = useReviewComments(source?.name ?? null, open)
  const { general: generalComments, openByDocument } = useMemo(
    () => groupComments(commentsData?.comments ?? []),
    [commentsData],
  )
  const hasComments = (commentsData?.comments.length ?? 0) > 0

  // A review that was asked something shows the conversation; silence stays
  // out of the way. Only on open and when switching workspaces - closing the
  // panel by hand must not be undone by the next poll.
  useEffect(() => {
    if (open) setShowComments(hasComments)
  }, [open, source?.name, hasComments])


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

  /**
   * Whether this publish will also complete the task - and it is the CONTENT
   * REPOSITORY that decides, not this dialog.
   *
   * Publishing a selection of documents is `PublishIndividualNodesFromWorkspace`,
   * which reports its event as `partial: !$remainingCommands->isEmpty()`
   * (WorkspaceCommandHandler): cover everything the workspace has, and the
   * publish is a FULL one. The task workflow's catch-up hook completes task
   * branches on exactly that event - so selecting all and publishing has always
   * completed the task, through the core, with nothing in the UI saying so.
   *
   * The dialog cannot prevent it without disarming the hook for the CLI and
   * the Workspace module too. What it can do is stop it from being a surprise:
   * the footer says it before, the toast confirms it after.
   */
  const publishCompletesTask =
    task !== null &&
    task.status !== 'DONE' &&
    selectedCount > 0 &&
    selectedCount === documents.length &&
    documents.length === (data?.documents.length ?? 0)

  const run = (kind: 'publish' | 'discard') => {
    const ids = selected.map((d) => d.documentAggregateId)
    if (ids.length === 0 || !source) return
    const sourceWorkspaceName = source.name
    const completesTask = kind === 'publish' && publishCompletesTask
    operation.mutate(
      { kind, filter: { documents: ids } },
      {
        onSuccess: () => {
          setSelectedIds(new Set())
          if (kind !== 'publish') return
          onPublished?.(sourceWorkspaceName)
          if (completesTask) {
            toast.success(t('tasks.completed', 'The task has been completed.'))
          }
        },
      },
    )
  }

  /**
   * The reviewed task has nothing left to publish - the work is out, only the
   * bookkeeping is missing. Measured against the WHOLE workspace, not against
   * the list on screen: that one is scoped to the active site, and a task that
   * also touched another site is not finished just because this site's share
   * is.
   */
  const readyToComplete =
    task !== null &&
    task.status !== 'DONE' &&
    (data?.documents.length ?? 0) === 0 &&
    !(source?.hasPublishableChanges ?? false) &&
    (source?.permissions.manage ?? false)

  const busy = operation.isPending || verdict.isPending
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
        <DialogContent
          size={showComments ? '2xl' : 'xl'}
          className="flex max-h-[90vh] flex-col"
        >
          <DialogHeader>
            <DialogTitle>
              {t('workspace.reviewChanges', 'Review changes')}
            </DialogTitle>
            <DialogDescription>
              {task
                ? t(
                    'review.taskDescription',
                    'Look at the changes, then approve them or hand the task back.',
                  )
                : t(
                    'workspace.review.selectDescription',
                    'Select documents to publish or discard.',
                  )}
            </DialogDescription>
          </DialogHeader>

          {/* Whose work this is and where it stands. The reviewer arrives
              from a notification or a board card and would otherwise be
              looking at a bare list of pages. */}
          {task && (
            <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 pb-3 text-sm dark:border-neutral-800">
              <i
                className="fas fa-code-branch text-xs"
                style={{ color: taskStatusColor(task.status) }}
                aria-hidden
              />
              <span className="truncate font-medium text-neutral-950 dark:text-white">
                {sourceLabel}
              </span>
              <span
                className="inline-flex items-center rounded-sm border border-current px-1 py-px text-[0.6rem] leading-none font-semibold tracking-wide uppercase select-none"
                style={{ color: taskStatusColor(task.status) }}
              >
                {taskStatusLabel(task.status)}
              </span>
              {task.assigneeLabel && (
                <span className="text-xs text-neutral-600 dark:text-neutral-400">
                  {t('tasks.assignedTo', 'Assigned to {0}', [
                    task.assigneeLabel,
                  ])}
                </span>
              )}
            </div>
          )}

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

            {/* The conversation is part of the review, not a place to go
                afterwards - so it opens right here, next to the changes it is
                about. */}
            <Button
              size="sm"
              variant={showComments ? 'secondary' : 'ghost'}
              className="mt-4 ml-auto"
              title={t(
                'review.commentsHint',
                'Discuss these changes with everyone involved',
              )}
              onClick={() => setShowComments((value) => !value)}
            >
              <i className="fas fa-fw fa-comments" aria-hidden />
              {t('review.comments', 'Comments')}
              {hasComments && (
                <span className="ml-1 tabular-nums text-neutral-600 dark:text-neutral-400">
                  {commentsData?.comments.length}
                </span>
              )}
            </Button>
          </div>

          <div className="flex min-h-0 flex-1 gap-4">
            <div className="flex min-w-0 flex-1 flex-col">
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
                title={
                  readyToComplete
                    ? t(
                        'review.allPublished',
                        'Nothing left to publish — the task can be completed.',
                      )
                    : t('workspace.review.empty', 'No pending changes.')
                }
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
                            {/* Remarks still waiting on somebody. The page
                                cannot show WHICH change they sit on - that is
                                the comparison's job - but it must show that
                                there are some, or they are only found by
                                opening every page. */}
                            {(openByDocument.get(id) ?? 0) > 0 && (
                              <span
                                className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400"
                                title={t(
                                  'review.openRemarksHint',
                                  'Open remarks on changes of this page',
                                )}
                              >
                                <i
                                  className="fas fa-comment-dots"
                                  aria-hidden
                                />
                                {openByDocument.get(id)}
                              </span>
                            )}
                          </div>
                        </div>
                        {/* Comparing is the main thing to DO with a row, so
                            it reads as a button with a word on it, not as one
                            more glyph among the row's small affordances. */}
                        <Button
                          size="sm"
                          variant="secondary"
                          className="shrink-0"
                          title={t(
                            'compare.openHint',
                            'Compare this page side by side',
                          )}
                          onClick={(event) => {
                            // Don't toggle the row's checkbox.
                            event.preventDefault()
                            setCompareDocumentId(id)
                          }}
                        >
                          <i
                            className="fas fa-fw fa-code-compare"
                            aria-hidden
                          />
                          {t('compare.openButton', 'Compare')}
                        </Button>
                        {document.documentAddress && canNavigate && (
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            className="shrink-0 text-blue-600 dark:text-blue-400"
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
                          </Button>
                        )}
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          className="shrink-0"
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
                        </Button>
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
            </div>

            {showComments && source && (
              <aside className="flex w-80 shrink-0 flex-col border-l border-neutral-200 pl-4 dark:border-neutral-800">
                <div className="shrink-0 text-xs text-neutral-600 dark:text-neutral-400">
                  {t('review.comments', 'Comments')}
                </div>
                <CommentThread
                  className="mt-2 flex min-h-0 flex-1 flex-col"
                  listClassName="min-h-0 flex-1 overflow-y-auto"
                  workspaceName={source.name}
                  comments={generalComments}
                  canManage={source.permissions.manage}
                  emptyLabel={t(
                    'review.noCommentsHint',
                    'Nothing said yet. Remarks about a single change belong in the side-by-side comparison.',
                  )}
                />
              </aside>
            )}
          </div>

          {/* The three answers a review has, in the order they are meant to
              read. Discarding is deliberately NOT one of them: it destroys the
              author's work, which is a thing to do to your OWN changes, never
              a reviewer's way of saying no. It keeps its place, on the far
              side of the footer, away from the verdict. */}
          {/* Said before the click, not discovered after it. */}
          {publishCompletesTask && (
            <div className="flex items-center gap-2 pt-3 text-xs text-neutral-600 dark:text-neutral-400">
              <i
                className="fas fa-circle-info text-blue-600 dark:text-blue-400"
                aria-hidden
              />
              {t(
                'review.publishCompletesTask',
                'This publishes everything the branch has — which completes the task.',
              )}
            </div>
          )}

          <DialogFooter className="border-t border-neutral-200 dark:border-neutral-800 pt-4">
            <Button
              variant="destructive"
              className="mr-auto"
              disabled={selectedCount === 0 || !canDiscard || busy}
              title={canDiscard ? undefined : discardDeniedHint}
              onClick={() => setConfirmDiscard(true)}
            >
              <i className="fas fa-fw fa-trash-can" aria-hidden />
              {t('workspace.review.discardSelected', 'Discard selected')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              {t('action.close', 'Close')}
            </Button>
            {task !== null && task.status !== 'DONE' && (
              <Button
                variant="secondary"
                className="text-amber-700 dark:text-amber-400"
                disabled={!canDiscard || busy}
                title={
                  canDiscard
                    ? t(
                        'review.requestChangesButtonHint',
                        'Send the task back with what needs doing — nothing is published or discarded',
                      )
                    : discardDeniedHint
                }
                onClick={() => setRequestingChanges(true)}
              >
                <i className="fas fa-fw fa-rotate-left" aria-hidden />
                {t('review.requestChanges', 'Request changes')}
              </Button>
            )}
            {/* Nothing left to publish on a task that is still open: the one
                sensible next act takes the primary slot, instead of a publish
                button that could not do anything anyway. */}
            {readyToComplete ? (
              <Button
                disabled={busy}
                className="bg-green-500 text-white hover:bg-green-400 dark:hover:bg-green-600"
                onClick={() => verdict.complete()}
              >
                <i
                  className={`fas fa-fw ${verdict.isPending ? 'fa-spinner fa-spin' : 'fa-check'}`}
                  aria-hidden
                />
                {t('tasks.completeTask', 'Complete task')}
              </Button>
            ) : (
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
            )}
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

      {source && (
        <CompareDialog
          open={compareDocumentId !== null}
          onOpenChange={(next) => !next && setCompareDocumentId(null)}
          source={source}
          workspaces={workspaces}
          documents={documents}
          initialDocumentId={compareDocumentId}
          canNavigate={canNavigate}
          onOpenPage={(address) => {
            setCompareDocumentId(null)
            goToDocument(address)
          }}
          onPublished={onPublished}
        />
      )}

      <RequestChangesDialog
        open={requestingChanges}
        onOpenChange={(next) => !next && setRequestingChanges(false)}
        pending={verdict.isPending}
        onSubmit={(reason) =>
          verdict.requestChanges(reason, () => setRequestingChanges(false))
        }
      />

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
