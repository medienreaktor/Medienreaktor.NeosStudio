import type { PropertyEditorComponent } from '../registry'
import { TextEditorBody } from './textEditorBody'

export const TEXT_AREA_EDITOR = 'Neos.Neos/Inspector/Editors/TextAreaEditor'

/** Multi-line text. */
export const TextAreaEditor: PropertyEditorComponent = (props) => (
  <TextEditorBody {...props} multiline={true} />
)
