import { useState } from 'react'
import { Eye, EyeOff, Trash2 } from 'lucide-react'
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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
 * delete behind a confirmation dialog. Runs the commands itself and reports
 * success through onDone - what to refresh and select afterwards is the
 * caller's business. Failures are surfaced as toasts here. Render
 * unconditionally: the confirmation dialog must survive the menu (target)
 * being closed.
 */
export function NodeContextMenu({
  target,
  entityLabel = 'element',
  onClose,
  onDone,
}: {
  target: NodeMenuTarget | null
  /** Noun used in the delete confirmation ("element", "document"). */
  entityLabel?: string
  /** The menu was closed (dismissed or an action was picked). */
  onClose: () => void
  /** A command succeeded for this target. */
  onDone: (action: NodeMenuAction, target: NodeMenuTarget) => void
}) {
  // A delete waiting for confirmation; the dialog is open while set.
  const [pendingDelete, setPendingDelete] = useState<NodeMenuTarget | null>(
    null,
  )

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
          title: action === 'hide' ? 'Hiding failed' : 'Unhiding failed',
        }),
      )
  }

  const runDelete = (deleteTarget: NodeMenuTarget) => {
    deleteNode(deleteTarget.address)
      .then(() => onDone('delete', deleteTarget))
      .catch((e: unknown) => toast.error(e, { title: 'Deleting failed' }))
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
            {target.hidden ? (
              <DropdownMenuItem
                disabled={target.tethered}
                onClick={() => runVisibilityAction(target, 'unhide')}
              >
                <Eye />
                Unhide
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                disabled={target.tethered}
                onClick={() => runVisibilityAction(target, 'hide')}
              >
                <EyeOff />
                Hide
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
              <Trash2 />
              Delete
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
            <DialogTitle>Delete this {entityLabel}?</DialogTitle>
            <DialogDescription>
              The {entityLabel} and everything inside it will be removed. This
              is undone by discarding the change from the workspace.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (pendingDelete) runDelete(pendingDelete)
                setPendingDelete(null)
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
