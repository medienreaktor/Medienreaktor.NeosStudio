import type { NodeDto } from '@/api/nodes'
import type { InspectorTab } from './inspectorSchema'

/**
 * ClientEval - dynamic inspector configuration, the contract established by
 * the classic Neos UI: any string value in the inspector part of a node type
 * configuration may read `ClientEval:<js expression>`, and the expression is
 * evaluated in the browser with `node` and `parentNode` in scope. The
 * canonical uses are hiding a property depending on another one
 *
 *     ui.inspector.hidden: 'ClientEval:node.properties.layout != "custom"'
 *
 * and feeding a property value into editor options (e.g. a data source's
 * dataSourceAdditionalData). Expressions see plain property values under
 * `node.properties` - including not-yet-saved editor input, so dependent
 * fields react while the user types, like the classic UI's transient values.
 */

const CLIENT_EVAL_PREFIX = 'ClientEval:'

/**
 * The node shape expressions evaluate against, mirroring what expressions
 * written for the classic UI rely on: plain (unwrapped) property values under
 * `properties`, the aggregate id under `identifier`.
 */
export interface ClientEvalNode {
  address: string
  identifier: string
  aggregateId: string
  name: string | null
  label: string
  nodeType: string
  properties: Record<string, unknown>
  tags: string[]
}

export interface ClientEvalContext {
  node: ClientEvalNode
  /** Null while unknown (not yet loaded, or the node is the root). */
  parentNode: ClientEvalNode | null
}

/**
 * Builds the expression-facing node from a NodeDto, unwrapping the property
 * transport envelope and overlaying not-yet-committed editor input on top of
 * the persisted values.
 */
export function clientEvalNode(
  node: NodeDto,
  transientValues?: Record<string, unknown>,
): ClientEvalNode {
  const properties: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(node.properties)) {
    properties[name] = value?.value
  }
  Object.assign(properties, transientValues)
  return {
    address: node.address,
    identifier: node.aggregateId,
    aggregateId: node.aggregateId,
    name: node.name,
    label: node.label,
    nodeType: node.nodeType,
    properties,
    tags: node.tags.all,
  }
}

export function isClientEvalExpression(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(CLIENT_EVAL_PREFIX)
}

/**
 * Compiled expressions, keyed by their source. Expressions come from node
 * type configuration (a small, session-stable set), while evaluation happens
 * per keystroke - compiling once keeps the hot path to a plain function call.
 */
const compiledExpressions = new Map<
  string,
  (node: ClientEvalNode, parentNode: ClientEvalNode | null) => unknown
>()

/**
 * Evaluates one ClientEval expression. A failing expression logs and yields
 * null (the classic UI contract - a typo hides a field, it never breaks the
 * inspector).
 */
export function evaluateClientEval(
  expression: string,
  context: ClientEvalContext,
): unknown {
  try {
    let fn = compiledExpressions.get(expression)
    if (!fn) {
      // eslint-disable-next-line no-new-func
      fn = new Function(
        'node',
        'parentNode',
        `return ${expression.slice(CLIENT_EVAL_PREFIX.length)}`,
      ) as (node: ClientEvalNode, parentNode: ClientEvalNode | null) => unknown
      compiledExpressions.set(expression, fn)
    }
    return fn(context.node, context.parentNode)
  } catch (e) {
    console.warn(
      `An error occurred while trying to evaluate "${expression}"\n`,
      e,
    )
    return null
  }
}

/**
 * Deep-evaluates every ClientEval string inside a configuration value
 * (editor options may nest them arbitrarily). Untouched branches keep their
 * identity so unchanged configuration stays referentially stable.
 */
export function preprocessClientEval<T>(
  value: T,
  context: ClientEvalContext,
): T {
  if (isClientEvalExpression(value)) {
    return evaluateClientEval(value, context) as T
  }
  if (Array.isArray(value)) {
    let changed = false
    const next = value.map((item) => {
      const processed = preprocessClientEval(item, context)
      if (processed !== item) changed = true
      return processed
    })
    return (changed ? next : value) as T
  }
  if (isPlainObject(value)) {
    let changed = false
    const next: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      const processed = preprocessClientEval(item, context)
      if (processed !== item) changed = true
      next[key] = processed
    }
    return (changed ? next : value) as T
  }
  return value
}

/**
 * Whether any ClientEval expression in the value mentions parentNode - only
 * then does evaluation need the (separately fetched) parent node.
 */
export function clientEvalUsesParentNode(value: unknown): boolean {
  if (isClientEvalExpression(value)) return value.includes('parentNode')
  if (Array.isArray(value)) return value.some(clientEvalUsesParentNode)
  if (isPlainObject(value)) {
    return Object.values(value).some(clientEvalUsesParentNode)
  }
  return false
}

/**
 * Applies ClientEval to a built inspector schema: evaluates each item's
 * `hidden` flag and drops hidden properties/views, evaluates expressions
 * inside editor and view options, and prunes groups and tabs that end up
 * empty.
 */
export function evaluateInspectorTabs(
  tabs: InspectorTab[],
  context: ClientEvalContext,
): InspectorTab[] {
  const visible = (hidden: boolean | string): boolean => {
    const evaluated = isClientEvalExpression(hidden)
      ? evaluateClientEval(hidden, context)
      : hidden
    return !evaluated
  }
  return tabs
    .map((tab) => ({
      ...tab,
      groups: tab.groups
        .map((group) => ({
          ...group,
          items: group.items
            .filter((item) =>
              visible(
                item.kind === 'property'
                  ? item.property.hidden
                  : item.view.hidden,
              ),
            )
            .map((item) =>
              item.kind === 'property'
                ? {
                    ...item,
                    property: {
                      ...item.property,
                      editorOptions: preprocessClientEval(
                        item.property.editorOptions,
                        context,
                      ),
                    },
                  }
                : {
                    ...item,
                    view: {
                      ...item.view,
                      viewOptions: preprocessClientEval(
                        item.view.viewOptions,
                        context,
                      ),
                    },
                  },
            ),
        }))
        .filter((group) => group.items.length > 0),
    }))
    .filter((tab) => tab.groups.length > 0)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  )
}

/**
 * Structural equality for evaluated configuration (JSON-shaped values plus
 * whatever scalars expressions return). Used to keep the evaluated schema's
 * identity stable across re-evaluations that change nothing, so editors do
 * not re-render or refetch on every inspected-node refresh.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => deepEqual(item, b[i]))
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keysA = Object.keys(a)
    const keysB = Object.keys(b)
    return (
      keysA.length === keysB.length &&
      keysA.every((key) => key in b && deepEqual(a[key], b[key]))
    )
  }
  return false
}
