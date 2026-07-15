import type { PropertyEditorComponent } from '../registry'
import { AssetField } from './AssetField'

export const ASSET_EDITOR = 'Neos.Neos/Inspector/Editors/AssetEditor'

/**
 * A single-asset property (any media type). Stores a reference to the picked
 * asset's concrete class; picking opens the Media Library. Multiple-asset mode
 * (editorOptions.multiple / array<Asset> properties) is not implemented yet.
 */
export const AssetEditor: PropertyEditorComponent = (props) => (
  <AssetField {...props} kind="asset" />
)
