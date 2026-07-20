import type { PropertyEditorComponent } from './registry'
import { TextEditorBody } from './textEditorBody'

export const TEXT_FIELD_EDITOR = 'Neos.Neos/Inspector/Editors/TextFieldEditor'

/** Single-line text (and the number editor for integer/float properties). */
export const TextFieldEditor: PropertyEditorComponent = (props) => (
  <TextEditorBody {...props} multiline={false} />
)
