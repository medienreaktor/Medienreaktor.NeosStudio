import type { PropertyEditorComponent } from '../registry'
import { AssetFieldEditor } from './AssetFieldEditor'
import { MultiAssetFieldEditor } from './MultiAssetFieldEditor'
import { isCollectionType } from './assetValue'

export const IMAGE_EDITOR = 'Neos.Neos/Inspector/Editors/ImageEditor'

/**
 * An image property; picking opens the Media Library. A single-image property
 * shows a preview and stores an Image reference; a collection property
 * (`array<Neos\Media\Domain\Model\ImageInterface>`) stores a list of them -
 * decided by the property type. Cropping/resizing (image variants) are not
 * implemented yet - they need a server-side createImageVariant equivalent.
 */
export const ImageEditor: PropertyEditorComponent = (props) =>
  isCollectionType(props.subject.type) ? (
    <MultiAssetFieldEditor {...props} kind="image" />
  ) : (
    <AssetFieldEditor {...props} kind="image" />
  )
