import type { PropertyEditorComponent } from '../registry'
import { AssetField } from './AssetField'

export const IMAGE_EDITOR = 'Neos.Neos/Inspector/Editors/ImageEditor'

/**
 * A single-image property. Shows a preview and stores an Image reference;
 * picking opens the Media Library. Cropping/resizing (image variants) are not
 * implemented yet - they need a server-side createImageVariant equivalent.
 */
export const ImageEditor: PropertyEditorComponent = (props) => (
  <AssetField {...props} kind="image" />
)
