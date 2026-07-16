import type { PropertyEditorComponent } from '../registry'
import { AssetField } from './AssetField'
import { MultiAssetField } from './MultiAssetField'
import { isCollectionType } from './assetValue'

export const ASSET_EDITOR = 'Neos.Neos/Inspector/Editors/AssetEditor'

/**
 * An asset property (any media type); picking opens the Media Library. A
 * single-asset property stores a reference to the picked asset's concrete
 * class; a collection property (`array<Neos\Media\Domain\Model\Asset>`) stores
 * a list of them - decided by the property type.
 */
export const AssetEditor: PropertyEditorComponent = (props) =>
  isCollectionType(props.subject.type) ? (
    <MultiAssetField {...props} kind="asset" />
  ) : (
    <AssetField {...props} kind="asset" />
  )
