import { useState } from 'react'
import { nodeReferences, useNodeReferences } from '@/api/neos/endpoints/nodes'
import type { NodeReference } from '@/api/neos/schema'
import { plainEditorOption } from '@/features/inspector/inspectorSchema'
import { nodeTypesFilter, objectOption } from './editorOptions'
import { NodePicker } from './NodePicker'
import {
  committedReferenceValue,
  parseReferenceIds,
  referenceEditorMode,
} from './referenceValue'
import type { PropertyEditorComponent, PropertyEditorProps } from './registry'

export const REFERENCE_EDITOR = 'Neos.Neos/Inspector/Editors/ReferenceEditor'
export const REFERENCES_EDITOR = 'Neos.Neos/Inspector/Editors/ReferencesEditor'

/**
 * Reference (single) and References (multi) editors: NodePicker over the
 * editor options, reading and committing as referenceEditorMode says. In
 * graph mode, targets the account may not read come without their node and
 * are left out; in the creation dialog (no nodeAddress) there is nothing to
 * read. The selection is the host's until the first local edit, then owned
 * here - the hosts remount the editor when the subject changes.
 */
function ReferenceEditorBase({
  id,
  subject,
  value,
  onCommit,
  onChange,
  options,
  nodeAddress,
  multiple,
}: PropertyEditorProps & { multiple: boolean }) {
  const mode = referenceEditorMode(subject.type)
  const { data: referencing } = useNodeReferences(
    nodeAddress ?? null,
    mode === 'graph',
  )
  const graphTargets =
    mode === 'graph' && referencing
      ? (nodeReferences(referencing)[subject.name] ?? []).flatMap(
          (reference: NodeReference) =>
            reference.node ? [reference.node] : [],
        )
      : []

  const [dirty, setDirty] = useState<string[] | null>(null)
  const selected =
    dirty ??
    (mode === 'graph'
      ? graphTargets.map((node) => node.nodeAggregateId)
      : parseReferenceIds(value))

  const change = (ids: string[]) => {
    setDirty(ids)
    const committed = committedReferenceValue(ids, multiple)
    onCommit(committed)
    if (mode === 'value') onChange?.(committed)
  }

  return (
    <NodePicker
      id={id}
      multiple={multiple}
      value={selected}
      onChange={change}
      knownNodes={graphTargets}
      nodeAddress={nodeAddress}
      nodeTypes={nodeTypesFilter(options)}
      threshold={options.threshold as number | undefined}
      placeholder={plainEditorOption(options, 'placeholder')}
      dataSourceIdentifier={plainEditorOption(options, 'dataSourceIdentifier')}
      dataSourceAdditionalData={objectOption(
        options,
        'dataSourceAdditionalData',
      )}
      dataSourceDisableCaching={options.dataSourceDisableCaching === true}
    />
  )
}

export const ReferenceEditor: PropertyEditorComponent = (props) => (
  <ReferenceEditorBase {...props} multiple={false} />
)

export const ReferencesEditor: PropertyEditorComponent = (props) => (
  <ReferenceEditorBase {...props} multiple />
)
