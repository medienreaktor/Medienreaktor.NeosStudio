import * as React from 'react'
import { type Node, nodeAddressKey } from '@/api/neos/schema'
import type { StudioActions } from '@/app/StudioContext'
import { toast } from '@/components/ui/toast'
import { ObservableRegistry, useRegistry } from '@/lib/registry'

/**
 * The action registries: commands a plugin adds to Studio's own menus and
 * bars, as data - an id, a label, an icon and a function to run. The shell
 * renders them (menu items, icon buttons), so a plugin supplies no component
 * here and needs no error boundary; what it does supply - `when` and `run` -
 * is called through the guards below, so a broken plugin action is hidden or
 * reports its failure as a toast, and never takes a menu down with it.
 *
 * Two registries, not one with a placement field: a node action is about a
 * node and shows wherever a node offers commands (the trees' and the
 * preview's context menus, the documents toolbar), a header action is about
 * nothing in particular and is always an icon button. One contract for both
 * would make `node` optional in every signature and leave half the fields
 * meaningless for each placement.
 */

/** Where a node action was offered. */
export type NodeActionSurface =
  /** Right-click on a row of the document tree. */
  | 'documentTree'
  /** Right-click on a row of the content outliner. */
  | 'contentOutliner'
  /** The "..." handle of a content element in the preview. */
  | 'preview'
  /** The documents panel's toolbar menu, acting on the selected document. */
  | 'documentsToolbar'

/** What a node action gets besides the node it was invoked on. */
export interface NodeActionContext {
  /** Where the action was offered - for actions that only fit some places. */
  surface: NodeActionSurface
  /**
   * Every node the invocation is about, the invoked-on node included: the
   * whole multi-selection when a tree's menu was opened on one, otherwise
   * just the node. A node whose ancestor is selected too is left out (the
   * ancestor's subtree covers it), as for the built-in bulk actions.
   */
  selection: Node[]
  /**
   * The shell's actions - e.g. `studio.nodeEdited(node)` after changing a
   * node, so trees, inspector and preview refresh (a Node is a NodeAddress).
   */
  studio: StudioActions
}

export interface NodeActionDefinition {
  /** Unique id. Third-party entries should namespace ('vendor.package:lock'). */
  id: string
  /** Menu label, already translated. */
  label: string
  /** Font Awesome icon name, any syntax `ui.icon` accepts (e.g. "lock", "fas fa-lock"). */
  icon?: string
  /** Sort weight; lower comes first. Defaults to 100. */
  order?: number
  /**
   * Actions sharing a group render together, separated from the other
   * groups. Groups appear in the order of their first action.
   */
  group?: string
  /** Rendered in the destructive style (red) - for actions that remove or overwrite. */
  destructive?: boolean
  /**
   * Whether to offer the action for this node. Called while the menu
   * renders, so it must be cheap and synchronous (derive from the node:
   * nodeType, tags, properties). Absent: always offered. A `when` that
   * throws hides the action and logs the error.
   */
  when?: (node: Node, context: NodeActionContext) => boolean
  /**
   * Run the action. A rejected promise or a throw is shown as an error
   * toast (with the message) and logged with the action id; while a
   * returned promise is pending the action shows as busy and cannot be run
   * again for the same node.
   */
  run: (node: Node, context: NodeActionContext) => void | Promise<void>
}

/** What a header action gets to look at. */
export interface HeaderActionContext {
  /** The selected document, or null while none is. */
  document: Node | null
  /** The active workspace's name, or null while workspaces load. */
  workspaceName: string | null
  /** The shell's actions, as for node actions. */
  studio: StudioActions
}

export interface HeaderActionDefinition {
  /** Unique id. Third-party entries should namespace ('vendor.package:report'). */
  id: string
  /** Tooltip and accessible name, already translated. */
  label: string
  /** Font Awesome icon name, any syntax `ui.icon` accepts. The button shows only the icon. */
  icon: string
  /** Sort weight; lower comes first (further left). Defaults to 100. */
  order?: number
  /**
   * Whether to show the button now; re-evaluated whenever the header
   * renders (document, workspace, dimension changes). Must be cheap. A
   * `when` that throws hides the button and logs the error.
   */
  when?: (context: HeaderActionContext) => boolean
  /** Run the action; errors and busy state as for node actions. */
  run: (context: HeaderActionContext) => void | Promise<void>
}

/**
 * Node actions sorted by `order` then registration order. Plain
 * ObservableRegistry: register-replaces-by-id, stable snapshot.
 */
export class NodeActionRegistry extends ObservableRegistry<NodeActionDefinition> {
  constructor() {
    super({ sort: 'order' })
  }
}

/** Header actions sorted by `order` then registration order. */
export class HeaderActionRegistry extends ObservableRegistry<HeaderActionDefinition> {
  constructor() {
    super({ sort: 'order' })
  }
}

export const nodeActionRegistry = new NodeActionRegistry()
export const headerActionRegistry = new HeaderActionRegistry()

export function useNodeActions(): NodeActionDefinition[] {
  return useRegistry(nodeActionRegistry)
}

export function useHeaderActions(): HeaderActionDefinition[] {
  return useRegistry(headerActionRegistry)
}

/**
 * Evaluate a `when` guard: absent means yes, a throw means no - logged, so a
 * plugin's broken condition costs its own action, never the menu.
 */
/** Definitions whose `when` threw and was logged; a re-registered (fixed) one is a new object and logs afresh. */
const reportedWhenErrors = new WeakSet<object>()

export function offered<Args extends unknown[]>(
  definition: {
    id: string
    when?: (...args: Args) => boolean
  },
  ...args: Args
): boolean {
  if (!definition.when) return true
  try {
    return definition.when(...args)
  } catch (error) {
    // `when` runs on every render of every menu and toolbar offering the
    // action, so log a broken one once per definition, not per render.
    if (!reportedWhenErrors.has(definition)) {
      reportedWhenErrors.add(definition)
      console.error(
        `Studio: the "when" of action "${definition.id}" threw; the action is hidden.`,
        error,
      )
    }
    return false
  }
}

/**
 * The node actions to offer for this node, split into their groups (in the
 * order of each group's first action) - a menu renders a separator between
 * groups.
 */
export function offeredNodeActionGroups(
  actions: NodeActionDefinition[],
  node: Node,
  context: NodeActionContext,
): NodeActionDefinition[][] {
  const groups = new Map<string, NodeActionDefinition[]>()
  for (const action of actions) {
    if (!offered(action, node, context)) continue
    // Ungrouped actions share one anonymous group.
    const key = action.group ?? ''
    groups.set(key, [...(groups.get(key) ?? []), action])
  }
  return [...groups.values()]
}

// Running actions, keyed by action and subject (see busyKey): a module-level
// store so the busy state survives the menu that started the run closing,
// and a reopened menu still shows the action busy.
const running = new Set<string>()
const runningListeners = new Set<() => void>()

function setRunning(key: string, value: boolean): void {
  if (value) running.add(key)
  else running.delete(key)
  runningListeners.forEach((listener) => listener())
}

function subscribeRunning(listener: () => void): () => void {
  runningListeners.add(listener)
  return () => {
    runningListeners.delete(listener)
  }
}

/** The busy-state key of an action run on a node (or on nothing, for header actions). */
export function busyKey(actionId: string, node?: Node | null): string {
  return node ? `${actionId} ${nodeAddressKey(node)}` : actionId
}

/** Whether the action is running for this key; re-renders when that changes. */
export function useActionBusy(key: string): boolean {
  return React.useSyncExternalStore(subscribeRunning, () => running.has(key))
}

/**
 * How long a pending run goes without feedback before a loading toast
 * appears - quick actions finish without a toast flashing up.
 */
const LOADING_TOAST_DELAY_MS = 400

/**
 * Run a plugin action's `run` with the guarantees the registries promise: a
 * sync throw and a rejected promise both end as an error toast titled with
 * the action's label and a console error naming its id; a pending promise
 * marks the key busy (a second run while busy is ignored). `announce` adds a
 * loading toast for a run that takes a moment - for surfaces that close on
 * click (menus), where the busy state is otherwise out of sight; the error
 * toast replaces it in place.
 */
export function runAction(
  action: { id: string; label: string },
  key: string,
  invoke: () => void | Promise<void>,
  { announce = false }: { announce?: boolean } = {},
): void {
  if (running.has(key)) return
  const toastId = `action:${key}`
  const fail = (error: unknown) => {
    console.error(`Studio: action "${action.id}" failed:`, error)
    toast.error(error, { title: action.label, id: toastId })
  }
  let result: unknown
  try {
    result = invoke()
  } catch (error) {
    fail(error)
    return
  }
  // Any thenable counts - a plugin's promise library is its own business.
  if (!isThenable(result)) return
  setRunning(key, true)
  const timer = announce
    ? setTimeout(
        () => toast.loading(action.label, { id: toastId }),
        LOADING_TOAST_DELAY_MS,
      )
    : undefined
  Promise.resolve(result)
    .then(
      () => {
        clearTimeout(timer)
        if (announce) toast.dismiss(toastId)
      },
      (error: unknown) => {
        clearTimeout(timer)
        fail(error)
      },
    )
    .finally(() => setRunning(key, false))
}

function isThenable(value: unknown): value is PromiseLike<void> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  )
}
