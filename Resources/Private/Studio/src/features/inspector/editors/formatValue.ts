import { useEffect, useState } from 'react'
import { hashKey } from '@tanstack/react-query'
import { resolveAsset } from '@/api/neos/endpoints/assets'
import { fetchDataSource } from '@/api/neos/endpoints/dataSources'
import { resolveNodes } from '@/api/neos/endpoints/nodes'
import { fetchNodeTypes, nodeTypeMap } from '@/api/neos/endpoints/nodeTypes'
import { editingSubgraph } from '@/app/editingSubgraph'
import { useStudio } from '@/app/StudioContext'
import {
  humanizeLabel,
  nodeTypeLabel,
  plainEditorOption,
} from '@/features/inspector/inspectorSchema'
import { useRegistry } from '@/lib/registry'
import {
  propertyEditorRegistry,
  type FormattedValue,
  type ValueFormatContext,
} from './registry'
import { createValueFormatters, plainFormattedValue } from './valueFormatters'

export const builtinValueFormatters = createValueFormatters({
  option: plainEditorOption,
  humanizeLabel,
  fallbackSubgraph: editingSubgraph,
  resolveNodes,
  fetchAsset: (id) => resolveAsset('neos', id),
  fetchDataSource,
  nodeTypeLabel: async (contentRepositoryId, name) => {
    const types = nodeTypeMap(await fetchNodeTypes(contentRepositoryId))
    return types.has(name) ? nodeTypeLabel(name, types.get(name)) : null
  },
})

/** formatEditorValue's context: the options default to none. */
export type FormatEditorValueContext = Omit<ValueFormatContext, 'options'> & {
  options?: Record<string, unknown>
}

/** Calls the formatter: a label now, or a promise for one that needs lookups. */
function runFormatter(
  editorId: string | null | undefined,
  value: unknown,
  context: FormatEditorValueContext,
): FormattedValue | null | Promise<FormattedValue | null> {
  const formatValue =
    propertyEditorRegistry.getDefinition(editorId)?.formatValue
  if (!formatValue) return plainFormattedValue(value)
  return formatValue(value, { ...context, options: context.options ?? {} })
}

/**
 * A value as the editor `editorId` shows it (see
 * PropertyEditorDefinition.formatValue), or its plain rendering for an
 * editor without a formatter. Rejects when a lookup fails; a value pointing
 * at something gone resolves with `missing`.
 */
export async function formatEditorValue(
  editorId: string | null | undefined,
  value: unknown,
  context: FormatEditorValueContext,
): Promise<FormattedValue | null> {
  return runFormatter(editorId, value, context)
}

/** One value for useFormattedValues. */
export interface FormattedValueRequest {
  editorId: string | null | undefined
  value: unknown
  context: FormatEditorValueContext
}

export interface FormattedValues {
  /**
   * Per item: its label, null for nothing to show, undefined until the
   * first one is resolved. While a changed value resolves, the item keeps
   * its last label.
   */
  labels: (FormattedValue | null | undefined)[]
  /** Some label is still being resolved. */
  pending: boolean
}

/** Options come from the node type schema and keep their identity: hashed once. */
const optionHashes = new WeakMap<object, string>()

function optionsHash(options: Record<string, unknown> | undefined): string {
  if (!options) return '{}'
  let hash = optionHashes.get(options)
  if (hash === undefined) {
    hash = hashKey([options])
    optionHashes.set(options, hash)
  }
  return hash
}

/** Items without a node are looked up in the fallback subgraph: it is part of their key. */
function itemKey(
  { editorId, value, context }: FormattedValueRequest,
  fallback: string,
): string {
  return hashKey([
    editorId ?? null,
    value ?? null,
    optionsHash(context.options),
    context.subject,
    context.nodeAddress ?? fallback,
  ])
}

/** The labels resolved last, by item key - what a remounted list starts with. */
const resolvedLabels = new Map<string, FormattedValue | null>()
const RESOLVED_LABELS_KEPT = 500

function rememberLabel(key: string, label: FormattedValue | null) {
  resolvedLabels.delete(key)
  resolvedLabels.set(key, label)
  if (resolvedLabels.size > RESOLVED_LABELS_KEPT) {
    const oldest = resolvedLabels.keys().next().value
    if (oldest !== undefined) resolvedLabels.delete(oldest)
  }
}

/** A label known right away, or the promise of one. */
type Run =
  | { key: string; label: FormattedValue | null; promise?: undefined }
  | { key: string; promise: Promise<FormattedValue | null> }

function startRun(key: string, item: FormattedValueRequest): Run {
  try {
    const result = runFormatter(item.editorId, item.value, item.context)
    if (!(result instanceof Promise)) return { key, label: result }
    return {
      key,
      promise: result.catch(() => plainFormattedValue(item.value)),
    }
  } catch {
    return { key, label: plainFormattedValue(item.value) }
  }
}

function replaced<T>(list: T[], index: number, item: T): T[] {
  const copy = [...list]
  copy[index] = item
  return copy
}

interface Shown {
  runKey: string
  editors: unknown
  runs: Run[]
  labels: (FormattedValue | null | undefined)[]
  done: boolean[]
}

/**
 * The labels of a list of values, each as its editor shows it - for list
 * rows and summaries. Items are told apart by their editor, value, options,
 * subject and node, not by object identity, so a new items array with the
 * same values neither refetches nor flickers.
 */
export function useFormattedValues(
  items: readonly FormattedValueRequest[],
): FormattedValues {
  // The fallback subgraph and the registered formatters are inputs too.
  const { site, workspaceName, selectedDocument } = useStudio()
  const editors = useRegistry(propertyEditorRegistry)
  const fallback = [
    site?.nodeAggregateId,
    workspaceName,
    selectedDocument?.dimensionSpacePoint,
  ].join('\n')
  const keys = items.map((item) => itemKey(item, fallback))
  const runKey = keys.join('\n')

  // Restarted during render when the items change (React's pattern for state
  // derived from props): a label known right away shows in the same render,
  // and the others keep the label their position showed last.
  const [shown, setShown] = useState<Shown | null>(null)
  let current = shown
  if (
    current === null ||
    current.runKey !== runKey ||
    current.editors !== editors
  ) {
    const previous = current
    const runs = keys.map((key, index) => startRun(key, items[index]!))
    current = {
      runKey,
      editors,
      runs,
      labels: runs.map((run, index) => {
        if (run.promise === undefined) return run.label
        if (resolvedLabels.has(run.key)) return resolvedLabels.get(run.key)
        return previous?.labels[index]
      }),
      done: runs.map((run) => run.promise === undefined),
    }
    setShown(current)
  }

  const runs = current.runs
  useEffect(() => {
    let active = true
    runs.forEach((run, index) => {
      if (run.promise === undefined) {
        rememberLabel(run.key, run.label)
        return
      }
      void run.promise.then((label) => {
        rememberLabel(run.key, label)
        if (!active) return
        setShown((state) =>
          state === null || state.runs !== runs
            ? state
            : {
                ...state,
                labels: replaced(state.labels, index, label),
                done: replaced(state.done, index, true),
              },
        )
      })
    })
    return () => {
      active = false
    }
  }, [runs])

  return { labels: current.labels, pending: current.done.includes(false) }
}
