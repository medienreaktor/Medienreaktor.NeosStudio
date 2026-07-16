import type { PropertyEditorComponent } from '../registry'
import { AssetFieldEditor } from './AssetFieldEditor'
import { MultiAssetFieldEditor } from './MultiAssetFieldEditor'
import { isCollectionType } from '@/api/assetValue'

export const ASSET_EDITOR = 'Neos.Neos/Inspector/Editors/AssetEditor'

/**
 * An asset property (any media type); picking opens the Media Library. A
 * single-asset property stores a reference to the picked asset's concrete
 * class; a collection property (`array<Neos\Media\Domain\Model\Asset>`) stores
 * a list of them - decided by the property type.
 */
export const AssetEditor: PropertyEditorComponent = (props) =>
  isCollectionType(props.subject.type) ? (
    <MultiAssetFieldEditor {...props} kind="asset" />
  ) : (
    <AssetFieldEditor {...props} kind="asset" />
  )
