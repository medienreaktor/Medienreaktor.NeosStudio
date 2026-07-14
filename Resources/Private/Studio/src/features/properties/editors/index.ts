import { propertyEditorRegistry } from '../registry'
import { BOOLEAN_EDITOR, BooleanEditor } from './BooleanEditor'
import { SELECT_BOX_EDITOR, SelectBoxEditor } from './SelectBoxEditor'
import { TEXT_AREA_EDITOR, TextAreaEditor } from './TextAreaEditor'
import {
  TEXT_FIELD_EDITOR,
  TextFieldEditor,
  URI_PATH_SEGMENT_EDITOR,
} from './TextFieldEditor'

/**
 * Studio's built-in property editors: one file per editor, each conforming to
 * the shared editor contract (see registry.ts) so the same component serves
 * both the inspector and the node creation dialogs. This barrel registers them
 * under the Neos editor identifiers that node type configuration references.
 */

export {
  BOOLEAN_EDITOR,
  BooleanEditor,
  SELECT_BOX_EDITOR,
  SelectBoxEditor,
  TEXT_AREA_EDITOR,
  TextAreaEditor,
  TEXT_FIELD_EDITOR,
  TextFieldEditor,
  URI_PATH_SEGMENT_EDITOR,
}

/**
 * Register the built-in editors. Called once before the app mounts, exactly
 * like third-party editors would be registered from a plugin entry point.
 */
export function registerBuiltinPropertyEditors(): void {
  propertyEditorRegistry.register({
    id: TEXT_FIELD_EDITOR,
    component: TextFieldEditor,
  })
  propertyEditorRegistry.register({
    id: URI_PATH_SEGMENT_EDITOR,
    component: TextFieldEditor,
  })
  propertyEditorRegistry.register({
    id: TEXT_AREA_EDITOR,
    component: TextAreaEditor,
  })
  propertyEditorRegistry.register({
    id: BOOLEAN_EDITOR,
    component: BooleanEditor,
  })
  propertyEditorRegistry.register({
    id: SELECT_BOX_EDITOR,
    component: SelectBoxEditor,
  })
}
