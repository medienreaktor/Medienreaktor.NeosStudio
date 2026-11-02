import { useState } from 'react'
import { toast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { aggregateIdOf } from '@/api/nodeAddress'
import { fetchNode, useAllowedChildNodeTypes } from '@/api/nodes'
import { translate as t } from '@/lib/i18n'
import {
  activeClipboardEntry,
  type ClipboardKind,
  type ClipboardMode,
  clipboardAdd,
  useClipboard,
} from '@/features/clipboard/clipboardStore'
import {
  pasteClipboardEntry,
  resolveSucceedingSibling,
} from '@/features/clipboard/paste'
import { deleteNodes, hideNodes, unhideNodes } from './nodeActions'

/**
 * The node the context menu is open for, plus where to anchor it. Built by
 * the preview (from the "..." handle) and the trees (from a right-click).
 */
export interface NodeMenuTarget {
  address: string
  /** Address of the parent node - focused and refreshed after a delete. */
  parentAddress: string | null
  /** Explicitly hidden (tag set on the node itself) - offers "Unhide". */
  hidden: boolean
  /** Tethered (autocreated) nodes can neither be hidden nor deleted. */
  tethered: boolean
  /**
   * What the account's access roles allow ON THIS NODE, per action. Absent =
   * everything (the unrestricted case). Copy is deliberately not in here: it
   * reads, and where the copy may be pasted is the paste target's own
   * question.
   */
  permitted?: {
    /** Create inside it - "Create new…" and both paste directions. */
    create: boolean
    /** Change it - hide and unhide. */
    edit: boolean
    delete: boolean
    /** Take it away from here - cut. */
    move: boolean
  }
  /** Viewport rect the menu is anchored to (a point for right-clicks). */
  anchor: { x: number; y: number; width: number; height: number }
}

export type NodeMenuAction = 'hide' | 'unhide' | 'delete'

/**
 * Shared node context menu: hide (or unhide for explicitly hidden nodes) and
 * delete behind a confirmation dialog, plus - when the caller names its
 * clipboard kind - cut/copy/paste. Runs the commands itself and reports
 * success through onDone/onPasted - what to refresh and select afterwards is
 * the caller's business. Failures are surfaced as toasts here. Render
 * unconditionally: the confirmation dialog must survive the menu (target)
 * being closed.
 *
 * With a multi-selection (`selection` has more than one target) the bulk
 * actions - hide, unhide, delete, cut and copy - apply to every selected
 * node, each skipping the targets it cannot act on (tethered, not permitted,
 * or already in the wanted state) and showing how many it will affect. Cut
 * and copy capture the selection as ONE clipboard entry, pasted as a group.
 * Create stays single-node: an insertion point is one position.
 */
export function NodeContextMenu({
  target,
  selection,
  entityLabel = 'element',
  entityLabelPlural = 'elements',
  clipboardKind,
  onClose,
  onDone,
  onPasted,
  onCreateNew,
}: {
  target: NodeMenuTarget | null
  /**
   * Every target the menu acts on when it was opened on a multi-selection,
   * the clicked `target` included. Absent (or a single entry): the menu is
   * about the clicked target alone.
   */
  selection?: NodeMenuTarget[]
  /** Noun used in the delete confirmation ("element", "document"). */
  entityLabel?: string
  /** Plural noun for multi-selection labels ("elements", "documents"). */
  entityLabelPlural?: string
  /**
   * When set, the menu offers Cut/Copy/Paste against the clipboard, tagging
   * entries with this kind and only pasting entries of the same kind - so
   * documents and content never mix between the two trees.
   */
  clipboardKind?: ClipboardKind
  /** The menu was closed (dismissed or an action was picked). */
  onClose: () => void
  /** A command succeeded for these targets (one entry outside multi-select). */
  onDone: (action: NodeMenuAction, targets: NodeMenuTarget[]) => void
  /**
   * A paste succeeded: addresses whose children lists changed (the new
   * parent, and a cut entry's old parent), plus the pasted node's address.
   */
  onPasted?: (affectedAddresses: string[], newAddress: string) => void
  /**
   * When set, the menu leads with a "Create new…" item that hands the target
   * to the caller (which opens the insertion dialog). Offered for tethered
   * nodes too - they can't be moved or deleted, but creating inside them (or
   * next to them, where constraints permit) is fine.
   */
  onCreateNew?: (target: NodeMenuTarget) => void
}) {
  // A delete waiting for confirmation; the dialog is open while set.
  const [pendingDelete, setPendingDelete] = useState<NodeMenuTarget[] | null>(
    null,
  )

  // What the bulk actions (hide/unhide/delete) operate on: the whole
  // multi-selection when there is one, otherwise just the clicked target.
  // Each action applies to the subset it can act on and shows its count.
  const targets =
    target === null
      ? []
      : selection && selection.length > 1
        ? selection
        : [target]
  const multi = targets.length > 1
  const hidable = targets.filter(
    (t) => !t.hidden && !t.tethered && t.permitted?.edit !== false,
  )
  const unhidable = targets.filter(
    (t) => t.hidden && !t.tethered && t.permitted?.edit !== false,
  )
  const deletable = targets.filter(
    (t) => !t.tethered && t.permitted?.delete !== false,
  )
  const cuttable = targets.filter(
    (t) => !t.tethered && t.permitted?.move !== false,
  )
  const copyable = targets.filter((t) => !t.tethered)
  // Language-neutral "how many this will affect" suffix, multi-select only.
  const count = (n: number) => (multi ? ` (${n})` : '')

  const { entries, activeId } = useClipboard()
  const clipboardEntry =
    clipboardKind !== undefined
      ? (entries.find(
          (entry) => entry.id === activeId && entry.kind === clipboardKind,
        ) ?? null)
      : null

  // The node-type constraints of the two paste positions, cached for the
  // session (staleTime Infinity) so reopening the menu is instant. Only
  // fetched while the menu is open for a target with something to paste.
  const { data: intoAllowed } = useAllowedChildNodeTypes(
    clipboardEntry && target ? target.address : null,
  )
  const { data: afterAllowed } = useAllowedChildNodeTypes(
    clipboardEntry && target ? target.parentAddress : null,
  )

  // Pasting a node into itself is never meaningful (a cut into itself is a
  // cycle, a copy into itself is almost certainly a misclick) - for a group
  // entry, into any of its members. Pasting a COPIED entry after itself is,
  // though - that is the copy-then-paste-here duplicate gesture - so only a
  // cut entry (a no-op move) blocks the after position. A group pastes as a
  // whole, so every captured type must be allowed at the position.
  const entryTypes =
    clipboardEntry === null
      ? []
      : [...new Set(clipboardEntry.nodes.map((node) => node.nodeType))]
  const pasteOntoSelf =
    clipboardEntry !== null &&
    target !== null &&
    clipboardEntry.nodes.some(
      (node) => node.aggregateId === aggregateIdOf(target.address),
    )
  const canPasteInto =
    clipboardEntry !== null &&
    !pasteOntoSelf &&
    intoAllowed !== undefined &&
    entryTypes.every((nodeType) => intoAllowed.includes(nodeType))
  const canPasteAfter =
    clipboardEntry !== null &&
    !(pasteOntoSelf && clipboardEntry.mode === 'cut') &&
    target?.parentAddress != null &&
    afterAllowed !== undefined &&
    entryTypes.every((nodeType) => afterAllowed.includes(nodeType))
  // What the paste hints call the entry: the node's label, or the group size.
  const clipboardLabel =
    clipboardEntry === null
      ? ''
      : clipboardEntry.nodes.length === 1
        ? clipboardEntry.nodes[0].label
        : `${clipboardEntry.nodes.length} ${entityLabelPlural}`

  const runVisibilityAction = (
    menuTargets: NodeMenuTarget[],
    action: 'hide' | 'unhide',
  ) => {
    onClose()
    const run = action === 'hide' ? hideNodes : unhideNodes
    run(menuTargets.map((t) => t.address))
      .then(() => onDone(action, menuTargets))
      .catch((e: unknown) =>
        toast.error(e, {
          title:
            action === 'hide'
              ? t('editing.hideFailed', 'Hiding failed')
              : t('editing.unhideFailed', 'Unhiding failed'),
        }),
      )
  }

  const runDelete = (deleteTargets: NodeMenuTarget[]) => {
    deleteNodes(deleteTargets.map((t) => t.address))
      .then(() => onDone('delete', deleteTargets))
      .catch((e: unknown) =>
        toast.error(e, { title: t('editing.deleteFailed', 'Deleting failed') }),
      )
  }

  // Cut/copy: snapshot the nodes (label, type) onto the clipboard as ONE
  // entry - a multi-selection is captured as a group and pasted as one. The
  // fetches resolve from the tree's cache in practice.
  const runCapture = (menuTargets: NodeMenuTarget[], mode: ClipboardMode) => {
    if (clipboardKind === undefined) return
    onClose()
    Promise.all(menuTargets.map((menuTarget) => fetchNode(menuTarget.address)))
      .then((nodes) =>
        clipboardAdd(
          mode,
          clipboardKind,
          nodes.map((node, index) => ({
            address: node.address,
            aggregateId: node.aggregateId,
            nodeType: node.nodeType,
            label: node.label !== '' ? node.label : node.aggregateId,
            sourceParentAddress: menuTargets[index].parentAddress,
          })),
        ),
      )
      .catch((e: unknown) =>
        toast.error(e, {
          title:
            mode === 'cut'
              ? t('editing.cutFailed', 'Cutting failed')
              : t('editing.copyFailed', 'Copying failed'),
        }),
      )
  }

  const runPaste = (menuTarget: NodeMenuTarget, position: 'into' | 'after') => {
    // Re-read instead of closing over clipboardEntry: the async chain must
    // paste what is active NOW, and the guard keeps kinds separate even if
    // the entry changed between render and click.
    const entry = activeClipboardEntry()
    if (entry === null || entry.kind !== clipboardKind) return
    onClose()
    const resolveInsertion = async (): Promise<{
      parent: string
      sibling: string | null
    }> => {
      // Into: append as the last child, like a drop onto a folder.
      if (position === 'into')
        return { parent: menuTarget.address, sibling: null }
      // After: the target's parent, before the target's next sibling.
      if (menuTarget.parentAddress === null) {
        throw new Error(
          t(
            'editing.noParentToPaste',
            'The node has no parent to paste next to.',
          ),
        )
      }
      return {
        parent: menuTarget.parentAddress,
        sibling: await resolveSucceedingSibling(
          menuTarget.address,
          menuTarget.parentAddress,
        ),
      }
    }
    resolveInsertion()
      .then(({ parent, sibling }) =>
        pasteClipboardEntry(entry, parent, sibling),
      )
      .then(({ affectedAddresses, newAddress }) =>
        onPasted?.(affectedAddresses, newAddress),
      )
      .catch((e: unknown) =>
        toast.error(e, { title: t('editing.pasteFailed', 'Pasting failed') }),
      )
  }

  return (
    <>
      {target && (
        <DropdownMenu open onOpenChange={(open) => !open && onClose()}>
          {/* Invisible anchor at the requested position - the real trigger
              (guest handle or right-clicked tree row) is out of reach. */}
          <DropdownMenuTrigger
            aria-hidden
            tabIndex={-1}
            style={{
              position: 'fixed',
              left: target.anchor.x,
              top: target.anchor.y,
              width: target.anchor.width,
              height: target.anchor.height,
              opacity: 0,
              pointerEvents: 'none',
            }}
          />
          <DropdownMenuContent align="end">
            {onCreateNew && (
              <>
                <DropdownMenuItem
                  disabled={target.permitted?.create === false}
                  onClick={() => {
                    onClose()
                    onCreateNew(target)
                  }}
                >
                  <i className="fas fa-fw fa-plus" aria-hidden />
                  {t('editing.createNew', 'Create new…')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            {clipboardKind !== undefined && (
              <>
                <DropdownMenuItem
                  disabled={cuttable.length === 0}
                  onClick={() => runCapture(cuttable, 'cut')}
                >
                  <i className="fas fa-fw fa-scissors" aria-hidden />
                  {t('editing.cut', 'Cut')}
                  {count(cuttable.length)}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={copyable.length === 0}
                  onClick={() => runCapture(copyable, 'copy')}
                >
                  <i className="fas fa-fw fa-copy" aria-hidden />
                  {t('editing.copy', 'Copy')}
                  {count(copyable.length)}
                </DropdownMenuItem>
                {clipboardEntry && (
                  <>
                    <DropdownMenuItem
                      disabled={
                        !canPasteInto || target.permitted?.create === false
                      }
                      title={t(
                        'editing.pasteIntoHint',
                        'Paste “{0}” inside, as the last child',
                        [clipboardLabel],
                      )}
                      onClick={() => runPaste(target, 'into')}
                    >
                      <i className="fas fa-fw fa-paste" aria-hidden />
                      {t('editing.pasteInto', 'Paste into')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={
                        !canPasteAfter || target.permitted?.create === false
                      }
                      title={t(
                        'editing.pasteAfterHint',
                        'Paste “{0}” after this {1}',
                        [clipboardLabel, entityLabel],
                      )}
                      onClick={() => runPaste(target, 'after')}
                    >
                      <i className="fas fa-fw fa-paste" aria-hidden />
                      {t('editing.pasteAfter', 'Paste after')}
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuSeparator />
              </>
            )}
            {/* One entry per applicable direction: a single target gets its
                one entry (as before), a mixed multi-selection gets both -
                each acting on (and counting) its own subset. An entry whose
                whole subset is tethered/unpermitted renders disabled. */}
            {targets.some((t) => !t.hidden) && (
              <DropdownMenuItem
                disabled={hidable.length === 0}
                onClick={() => runVisibilityAction(hidable, 'hide')}
              >
                <i className="fas fa-fw fa-eye-slash" aria-hidden />
                {t('editing.hide', 'Hide')}
                {count(hidable.length)}
              </DropdownMenuItem>
            )}
            {targets.some((t) => t.hidden) && (
              <DropdownMenuItem
                disabled={unhidable.length === 0}
                onClick={() => runVisibilityAction(unhidable, 'unhide')}
              >
                <i className="fas fa-fw fa-eye" aria-hidden />
                {t('editing.unhide', 'Unhide')}
                {count(unhidable.length)}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              variant="destructive"
              disabled={deletable.length === 0}
              onClick={() => {
                setPendingDelete(deletable)
                onClose()
              }}
            >
              <i className="fas fa-fw fa-trash-can" aria-hidden />
              {t('editing.delete', 'Delete')}
              {count(deletable.length)}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pendingDelete !== null && pendingDelete.length > 1
                ? t('editing.deleteConfirm.titleMany', 'Delete {0} {1}?', [
                    pendingDelete.length,
                    entityLabelPlural,
                  ])
                : t('editing.deleteConfirm.title', 'Delete this {0}?', [
                    entityLabel,
                  ])}
            </DialogTitle>
            <DialogDescription>
              {pendingDelete !== null && pendingDelete.length > 1
                ? t(
                    'editing.deleteConfirm.descriptionMany',
                    'The selected {0} and everything inside them will be removed. This is undone by discarding the changes from the workspace.',
                    [entityLabelPlural],
                  )
                : t(
                    'editing.deleteConfirm.description',
                    'The {0} and everything inside it will be removed. This is undone by discarding the change from the workspace.',
                    [entityLabel],
                  )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setPendingDelete(null)}>
              {t('editing.cancel', 'Cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (pendingDelete !== null && pendingDelete.length > 0)
                  runDelete(pendingDelete)
                setPendingDelete(null)
              }}
            >
              {t('editing.delete', 'Delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
