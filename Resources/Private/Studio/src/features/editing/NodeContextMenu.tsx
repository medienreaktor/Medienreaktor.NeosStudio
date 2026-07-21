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
import { deleteNode, hideNode, unhideNode } from './nodeActions'

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
 */
export function NodeContextMenu({
  target,
  entityLabel = 'element',
  clipboardKind,
  onClose,
  onDone,
  onPasted,
  onCreateNew,
}: {
  target: NodeMenuTarget | null
  /** Noun used in the delete confirmation ("element", "document"). */
  entityLabel?: string
  /**
   * When set, the menu offers Cut/Copy/Paste against the clipboard, tagging
   * entries with this kind and only pasting entries of the same kind - so
   * documents and content never mix between the two trees.
   */
  clipboardKind?: ClipboardKind
  /** The menu was closed (dismissed or an action was picked). */
  onClose: () => void
  /** A command succeeded for this target. */
  onDone: (action: NodeMenuAction, target: NodeMenuTarget) => void
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
  const [pendingDelete, setPendingDelete] = useState<NodeMenuTarget | null>(
    null,
  )

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
  // cycle, a copy into itself is almost certainly a misclick).
  const pasteOntoSelf =
    clipboardEntry !== null &&
    target !== null &&
    clipboardEntry.aggregateId === aggregateIdOf(target.address)
  const canPasteInto =
    clipboardEntry !== null &&
    !pasteOntoSelf &&
    intoAllowed !== undefined &&
    intoAllowed.includes(clipboardEntry.nodeType)
  const canPasteAfter =
    clipboardEntry !== null &&
    !pasteOntoSelf &&
    target?.parentAddress != null &&
    afterAllowed !== undefined &&
    afterAllowed.includes(clipboardEntry.nodeType)

  const runVisibilityAction = (
    menuTarget: NodeMenuTarget,
    action: 'hide' | 'unhide',
  ) => {
    onClose()
    const run = action === 'hide' ? hideNode : unhideNode
    run(menuTarget.address)
      .then(() => onDone(action, menuTarget))
      .catch((e: unknown) =>
        toast.error(e, {
          title:
            action === 'hide'
              ? t('editing.hideFailed', 'Hiding failed')
              : t('editing.unhideFailed', 'Unhiding failed'),
        }),
      )
  }

  const runDelete = (deleteTarget: NodeMenuTarget) => {
    deleteNode(deleteTarget.address)
      .then(() => onDone('delete', deleteTarget))
      .catch((e: unknown) =>
        toast.error(e, { title: t('editing.deleteFailed', 'Deleting failed') }),
      )
  }

  // Cut/copy: snapshot the node (label, type) onto the clipboard. The fetch
  // resolves from the tree's cache in practice.
  const runCapture = (menuTarget: NodeMenuTarget, mode: ClipboardMode) => {
    if (clipboardKind === undefined) return
    onClose()
    fetchNode(menuTarget.address)
      .then((node) =>
        clipboardAdd(mode, clipboardKind, node, menuTarget.parentAddress),
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
                  disabled={target.tethered}
                  onClick={() => runCapture(target, 'cut')}
                >
                  <i className="fas fa-fw fa-scissors" aria-hidden />
                  {t('editing.cut', 'Cut')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={target.tethered}
                  onClick={() => runCapture(target, 'copy')}
                >
                  <i className="fas fa-fw fa-copy" aria-hidden />
                  {t('editing.copy', 'Copy')}
                </DropdownMenuItem>
                {clipboardEntry && (
                  <>
                    <DropdownMenuItem
                      disabled={!canPasteInto}
                      title={t(
                        'editing.pasteIntoHint',
                        'Paste “{0}” inside, as the last child',
                        [clipboardEntry.label],
                      )}
                      onClick={() => runPaste(target, 'into')}
                    >
                      <i className="fas fa-fw fa-paste" aria-hidden />
                      {t('editing.pasteInto', 'Paste into')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={!canPasteAfter}
                      title={t(
                        'editing.pasteAfterHint',
                        'Paste “{0}” after this {1}',
                        [clipboardEntry.label, entityLabel],
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
            {target.hidden ? (
              <DropdownMenuItem
                disabled={target.tethered}
                onClick={() => runVisibilityAction(target, 'unhide')}
              >
                <i className="fas fa-fw fa-eye" aria-hidden />
                {t('editing.unhide', 'Unhide')}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                disabled={target.tethered}
                onClick={() => runVisibilityAction(target, 'hide')}
              >
                <i className="fas fa-fw fa-eye-slash" aria-hidden />
                {t('editing.hide', 'Hide')}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              variant="destructive"
              disabled={target.tethered}
              onClick={() => {
                setPendingDelete(target)
                onClose()
              }}
            >
              <i className="fas fa-fw fa-trash-can" aria-hidden />
              {t('editing.delete', 'Delete')}
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
              {t('editing.deleteConfirm.title', 'Delete this {0}?', [
                entityLabel,
              ])}
            </DialogTitle>
            <DialogDescription>
              {t(
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
                if (pendingDelete) runDelete(pendingDelete)
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
