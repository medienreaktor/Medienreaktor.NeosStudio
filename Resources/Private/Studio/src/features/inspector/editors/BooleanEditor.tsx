import { useState } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import type { PropertyEditorComponent } from './registry'

export const BOOLEAN_EDITOR = 'Neos.Neos/Inspector/Editors/BooleanEditor'

/**
 * A boolean checkbox. Renders its own label beside the box (registered with
 * rendersOwnLabel, so the host does not add a label above it). No editing
 * phase - it commits on every toggle. Local state gives instant feedback on a
 * toggle, but the checkbox also adopts an external value change: the inspector
 * edits the same subject in place (the mount key is the node address, unchanged
 * when a tag flips), so hiding a node from a context menu must still tick the
 * "Hidden" box without a remount.
 */
export const BooleanEditor: PropertyEditorComponent = ({
  subject,
  value,
  onCommit,
}) => {
  const external = value === true
  const [checked, setChecked] = useState(external)
  const [lastExternal, setLastExternal] = useState(external)
  if (external !== lastExternal) {
    setLastExternal(external)
    setChecked(external)
  }
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <Checkbox
        checked={checked}
        onCheckedChange={(next) => {
          setChecked(next)
          onCommit(next)
        }}
      />
      {subject.label}
    </label>
  )
}
