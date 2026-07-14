import { useState } from 'react'
import type { PropertyEditorComponent } from '../registry'

export const BOOLEAN_EDITOR = 'Neos.Neos/Inspector/Editors/BooleanEditor'

/**
 * A boolean checkbox. No editing phase - it commits on every toggle. Local
 * state gives instant feedback on a toggle, but the checkbox also adopts an
 * external value change: the inspector edits the same subject in place (the
 * mount key is the node address, unchanged when a tag flips), so hiding a node
 * from a context menu must still tick the "Hidden" box without a remount.
 */
export const BooleanEditor: PropertyEditorComponent = ({ value, onCommit }) => {
  const external = value === true
  const [checked, setChecked] = useState(external)
  const [lastExternal, setLastExternal] = useState(external)
  if (external !== lastExternal) {
    setLastExternal(external)
    setChecked(external)
  }
  return (
    <input
      type="checkbox"
      className="size-4 self-start accent-primary"
      checked={checked}
      onChange={(event) => {
        setChecked(event.target.checked)
        onCommit(event.target.checked)
      }}
    />
  )
}
