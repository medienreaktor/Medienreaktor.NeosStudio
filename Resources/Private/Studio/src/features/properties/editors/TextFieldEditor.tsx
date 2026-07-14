import type { PropertyEditorComponent } from '../registry'
import { TextEditorBody } from './textEditorBody'

export const TEXT_FIELD_EDITOR = 'Neos.Neos/Inspector/Editors/TextFieldEditor'
// A text field with a "sync from title" button in the classic UI - plain text
// for now, so it reuses the text field editor.
export const URI_PATH_SEGMENT_EDITOR =
  'Neos.Neos/Inspector/Editors/UriPathSegmentEditor'

/** Single-line text (and the number editor for integer/float properties). */
export const TextFieldEditor: PropertyEditorComponent = (props) => (
  <TextEditorBody {...props} multiline={false} />
)
