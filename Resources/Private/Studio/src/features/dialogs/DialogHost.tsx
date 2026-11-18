import * as React from 'react'

import { ExtensionBoundary } from '@/components/ExtensionBoundary'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { useAssetPickerActive } from '@/features/media/AssetPicker'
import {
  type DialogEntry,
  dialogEntries,
  removeDialog,
  subscribeDialogs,
} from './store'

/**
 * Renders the dialogs opened with `dialogs.open()` inside the shell's
 * providers, so they get the studio context, the query client, the theme and
 * the translations like a panel. The host owns each dialog's root - open
 * state, Escape, outside clicks, the exit transition - and the component
 * renders the popup (`DialogContent`) with its size and content.
 */
export function DialogHost() {
  const entries = React.useSyncExternalStore(subscribeDialogs, dialogEntries)
  // A built-in asset editor picks by switching the main area to the Media
  // Library: the dialogs step aside meanwhile. The components stay mounted
  // (they are outside the popups), so their state survives the pick.
  const picking = useAssetPickerActive()
  return <DialogLayers entries={entries} parentId={null} picking={picking} />
}

/**
 * The dialogs opened on `parentId`, each with the ones opened on it as its
 * children: Base UI treats a dialog rendered inside another's root as
 * stacked on it - the one below steps back behind a veil, and Escape closes
 * only the top one.
 */
function DialogLayers({
  entries,
  parentId,
  picking,
}: {
  entries: DialogEntry[]
  parentId: number | null
  picking: boolean
}) {
  return entries
    .filter((entry) => entry.parentId === parentId)
    .map((entry) => {
      const Component = entry.component
      return (
        <Dialog
          key={entry.id}
          open={entry.open && !picking}
          onOpenChange={(open) => {
            if (!open && !picking) entry.close()
          }}
          onOpenChangeComplete={(open) => {
            if (!open) removeDialog(entry.id)
          }}
        >
          <ExtensionBoundary
            kind="dialog"
            id={entry.name}
            fallbackFrame={DialogContent}
          >
            <Component {...entry.props} close={entry.close} />
          </ExtensionBoundary>
          <DialogLayers
            entries={entries}
            parentId={entry.id}
            picking={picking}
          />
        </Dialog>
      )
    })
}
