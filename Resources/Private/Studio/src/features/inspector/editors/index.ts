import { builtinValueFormatters as formatters } from './formatValue'
import { propertyEditorRegistry } from './registry'
import { ASSET_EDITOR, AssetEditor } from './AssetEditor'
import { BOOLEAN_EDITOR, BooleanEditor } from './BooleanEditor'
import { CODE_EDITOR, CodeEditor } from './CodeEditor'
import { DATE_TIME_EDITOR, DateTimeEditor } from './DateTimeEditor'
import { IMAGE_EDITOR, ImageEditor } from './ImageEditor'
import { LINK_EDITOR, LinkFieldEditor } from './LinkFieldEditor'
import { NODE_TYPE_EDITOR, NodeTypeEditor } from './NodeTypeEditor'
import { RANGE_EDITOR, RangeEditor } from './RangeEditor'
import { RICH_TEXT_EDITOR, RichTextEditor } from './RichTextEditor'
import {
  REFERENCE_EDITOR,
  REFERENCES_EDITOR,
  ReferenceEditor,
  ReferencesEditor,
} from './ReferenceEditor'
import { SELECT_BOX_EDITOR, SelectBoxEditor } from './SelectBoxEditor'
import { TEXT_AREA_EDITOR, TextAreaEditor } from './TextAreaEditor'
import { TEXT_FIELD_EDITOR, TextFieldEditor } from './TextFieldEditor'
import {
  URI_PATH_SEGMENT_EDITOR,
  UriPathSegmentEditor,
} from './UriPathSegmentEditor'

/**
 * Studio's built-in property editors: one file per editor, each conforming to
 * the shared editor contract (see registry.ts) so the same component serves
 * both the inspector and the node creation dialogs. This barrel registers them
 * under the Neos editor identifiers that node type configuration references.
 */

/**
 * Register the built-in editors. Called once before the app mounts, exactly
 * like third-party editors would be registered from a plugin entry point.
 */
export function registerBuiltinPropertyEditors(): void {
  propertyEditorRegistry.register({
    id: ASSET_EDITOR,
    component: AssetEditor,
    formatValue: formatters.asset,
  })
  propertyEditorRegistry.register({
    id: IMAGE_EDITOR,
    component: ImageEditor,
    formatValue: formatters.asset,
  })
  propertyEditorRegistry.register({
    id: TEXT_FIELD_EDITOR,
    component: TextFieldEditor,
    formatValue: formatters.text,
  })
  propertyEditorRegistry.register({
    id: URI_PATH_SEGMENT_EDITOR,
    component: UriPathSegmentEditor,
    formatValue: formatters.text,
  })
  propertyEditorRegistry.register({
    id: TEXT_AREA_EDITOR,
    component: TextAreaEditor,
    formatValue: formatters.markup,
  })
  propertyEditorRegistry.register({
    id: CODE_EDITOR,
    component: CodeEditor,
    formatValue: formatters.text,
  })
  propertyEditorRegistry.register({
    id: DATE_TIME_EDITOR,
    component: DateTimeEditor,
    formatValue: formatters.dateTime,
  })
  propertyEditorRegistry.register({
    id: LINK_EDITOR,
    component: LinkFieldEditor,
    formatValue: formatters.link,
  })
  propertyEditorRegistry.register({
    id: BOOLEAN_EDITOR,
    component: BooleanEditor,
    formatValue: formatters.boolean,
    // The checkbox renders its own label beside the box.
    rendersOwnLabel: true,
  })
  propertyEditorRegistry.register({
    id: SELECT_BOX_EDITOR,
    component: SelectBoxEditor,
    formatValue: formatters.select,
  })
  propertyEditorRegistry.register({
    id: REFERENCE_EDITOR,
    component: ReferenceEditor,
    formatValue: formatters.reference,
  })
  propertyEditorRegistry.register({
    id: REFERENCES_EDITOR,
    component: ReferencesEditor,
    formatValue: formatters.reference,
  })
  propertyEditorRegistry.register({
    id: NODE_TYPE_EDITOR,
    component: NodeTypeEditor,
    formatValue: formatters.nodeType,
  })
  propertyEditorRegistry.register({
    id: RANGE_EDITOR,
    component: RangeEditor,
    formatValue: formatters.range,
  })
  propertyEditorRegistry.register({
    id: RICH_TEXT_EDITOR,
    component: RichTextEditor,
    formatValue: formatters.markup,
  })
}
