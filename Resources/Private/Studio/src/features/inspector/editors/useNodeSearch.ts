import { useEffect, useMemo } from 'react'
import { dataSourceSelectOptions } from '@/api/neos/endpoints/dataSourceOptions'
import { useDataSource } from '@/api/neos/endpoints/dataSources'
import { useNodeTypes } from '@/api/neos/endpoints/nodeTypes'
import { editingSiteNode } from '@/api/neos/endpoints/sites'
import type { NodeAddress } from '@/api/neos/schema'
import { useStudio } from '@/app/StudioContext'
import { faClassName } from '@/components/ui/icon'
import { toast } from '@/components/ui/toast'
import {
  documentBreadcrumb,
  useDocumentSearch,
} from '@/features/tree/documentSearch'
import { resolveNodeTypeIconClass } from '@/features/tree/nodeTypeIcon'
import { translate } from '@/lib/i18n'
import { nodeTypesFilter } from './editorOptions'
import type { ReferenceOption } from './ReferencePicker'

/** One pickable node: a search hit, or a data source option. */
export type NodeSearchHit = Pick<
  ReferenceOption,
  'id' | 'label' | 'iconClass' | 'secondary' | 'group' | 'disabled'
>

export interface NodeSearchParams {
  /** What is typed. */
  searchTerm: string
  /**
   * A node in the subgraph (workspace and dimensions) to search, usually
   * the edited node. Without one: the active workspace and the selected
   * document's dimensions. The site searched is the active one.
   */
  nodeAddress?: NodeAddress
  /**
   * The node types to find, a list or a comma-separated string in Neos'
   * NodeTypeCriteria syntax ("Neos.Neos:Document,!Acme:Folder"); documents
   * by default.
   */
  nodeTypes?: string | readonly string[]
  /** How many characters start a search; 2 by default. */
  threshold?: number
  /**
   * Offer a data source's options instead of searching: their values are
   * node aggregate ids, filtered by label as typed.
   */
  dataSourceIdentifier?: string
  dataSourceAdditionalData?: Record<string, unknown>
  dataSourceDisableCaching?: boolean
  /** False searches and loads nothing, e.g. while the picker is closed. */
  enabled?: boolean
}

export interface NodeSearch {
  hits: NodeSearchHit[]
  /** A search is running, or waiting for its debounce. */
  loading: boolean
  /** Why nothing is searched yet ("Type at least 2 characters"), or null. */
  hint: string | null
  /** Every data source option, unfiltered - the labels of values that are no node. */
  dataSourceOptions: NodeSearchHit[]
}

/**
 * The search behind NodePicker and the reference editors: fulltext over the
 * active site's nodes in the subgraph of `nodeAddress`, with the old UI's
 * cadence (`threshold` characters, 300 ms debounce), hits in branches the
 * account's access roles hide left out, each with its node type's icon and
 * its breadcrumb - or a data source's options, filtered by label.
 */
export function useNodeSearch(params: NodeSearchParams): NodeSearch {
  const { searchTerm, nodeAddress, enabled = true } = params
  const { data: nodeTypes } = useNodeTypes()
  const { site, workspaceName, selectedDocument } = useStudio()

  const dataSourceIdentifier = params.dataSourceIdentifier || null
  const dataSource = useDataSource({
    identifier: enabled ? dataSourceIdentifier : null,
    node: nodeAddress,
    additionalData: params.dataSourceAdditionalData,
    disableCaching: params.dataSourceDisableCaching === true,
  })
  const dataSourceOptions = useMemo(
    () =>
      dataSourceSelectOptions(dataSource.data).map((option): NodeSearchHit => ({
        id: option.key,
        label: option.label,
        iconClass: option.icon ? faClassName(option.icon) : null,
        group: option.group,
        disabled: option.disabled,
      })),
    [dataSource.data],
  )
  useEffect(() => {
    if (dataSource.error)
      toast.error(dataSource.error, {
        title: translate(
          'editor.loadingOptionsFailed',
          'Loading options failed',
        ),
      })
  }, [dataSource.error])

  const threshold =
    typeof params.threshold === 'number' && params.threshold >= 0
      ? params.threshold
      : 2
  const search = useDocumentSearch(
    editingSiteNode(
      site,
      workspaceName,
      selectedDocument?.dimensionSpacePoint,
      nodeAddress,
    ),
    site?.nodeName ?? '',
    searchTerm,
    nodeTypesFilter({ nodeTypes: params.nodeTypes }),
    {
      minLength: threshold,
      enabled: dataSourceIdentifier === null && enabled,
    },
  )
  useEffect(() => {
    if (search.error)
      toast.error(search.error, {
        title: translate('editor.searchFailed', 'Search failed'),
      })
  }, [search.error])

  if (dataSourceIdentifier !== null) {
    const term = searchTerm.trim().toLowerCase()
    return {
      hits: term
        ? dataSourceOptions.filter((option) =>
            option.label.toLowerCase().includes(term),
          )
        : dataSourceOptions,
      loading: dataSource.isPending,
      hint: null,
      dataSourceOptions,
    }
  }

  return {
    hits: search.hits.map((node): NodeSearchHit => ({
      id: node.nodeAggregateId,
      label: node.label || node.nodeAggregateId,
      iconClass: resolveNodeTypeIconClass(nodeTypes, node.nodeType),
      secondary: documentBreadcrumb(node, nodeTypes).join(' › '),
    })),
    loading: search.loading,
    hint:
      searchTerm.trim().length < threshold
        ? threshold === 1
          ? translate(
              'editor.reference.typeAtLeastOne',
              'Type at least {0} character to search',
              [threshold],
            )
          : translate(
              'editor.reference.typeAtLeast',
              'Type at least {0} characters to search',
              [threshold],
            )
        : null,
    dataSourceOptions: [],
  }
}
