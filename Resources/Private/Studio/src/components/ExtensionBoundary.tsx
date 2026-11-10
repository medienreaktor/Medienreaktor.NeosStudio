import * as React from 'react'

import { Button } from '@/components/ui/button'
import { translate as t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/**
 * What a boundary guards: the registry the component came from, which names
 * it in the fallback and the console. Built-in and plugin entries go through
 * the same registries and so the same boundaries.
 */
export type ExtensionKind =
  'panel' | 'editor' | 'view' | 'settingsSection' | 'linkType'

interface ExtensionBoundaryProps {
  kind: ExtensionKind
  /** The registry id of the guarded entry. */
  id: string
  /**
   * 'block' fills its container (panels, settings sections, link tabs);
   * 'inline' is one row in a form (inspector editors and views).
   */
  variant?: 'block' | 'inline'
  /**
   * When any of these change, a crashed boundary tries again - e.g. the
   * inspected node, so a broken editor recovers on the next node instead of
   * staying broken for the session.
   */
  resetKeys?: readonly unknown[]
  children: React.ReactNode
}

interface ExtensionBoundaryState {
  error: Error | null
}

/**
 * One full sentence per kind: a noun slotted into a shared sentence does not
 * survive translation (gender, case).
 */
function crashMessage(kind: ExtensionKind): string {
  switch (kind) {
    case 'panel':
      return t('extension.crashed.panel', 'This panel could not be displayed.')
    case 'editor':
      return t(
        'extension.crashed.editor',
        'This editor could not be displayed.',
      )
    case 'view':
      return t('extension.crashed.view', 'This view could not be displayed.')
    case 'settingsSection':
      return t(
        'extension.crashed.settingsSection',
        'This settings section could not be displayed.',
      )
    case 'linkType':
      return t(
        'extension.crashed.linkType',
        'This link type could not be displayed.',
      )
  }
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

function sameKeys(
  a: readonly unknown[] | undefined,
  b: readonly unknown[] | undefined,
): boolean {
  if (a === b) return true
  if (!a || !b || a.length !== b.length) return false
  return a.every((value, index) => Object.is(value, b[index]))
}

/**
 * Contains a crash of one registered component - a plugin's panel, editor,
 * view, settings section or link type, or a built-in one - to that
 * component. Without it, React 19 unmounts the whole app on an error thrown
 * while rendering (or in an effect), so one broken plugin would blank Studio
 * for every editor. The fallback names the component, offers to try again,
 * and the error goes to the console with the registry id.
 *
 * Errors in event handlers and async code never reach a boundary; they do
 * not unmount anything either, so the component keeps working around them.
 */
export class ExtensionBoundary extends React.Component<
  ExtensionBoundaryProps,
  ExtensionBoundaryState
> {
  override state: ExtensionBoundaryState = { error: null }

  static getDerivedStateFromError(error: unknown): ExtensionBoundaryState {
    return { error: toError(error) }
  }

  override componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    console.error(
      `Studio: the ${this.props.kind} "${this.props.id}" crashed and was replaced by a fallback.`,
      error,
      info.componentStack ?? '',
    )
  }

  override componentDidUpdate(previous: ExtensionBoundaryProps): void {
    if (
      this.state.error &&
      (previous.id !== this.props.id ||
        !sameKeys(previous.resetKeys, this.props.resetKeys))
    ) {
      this.reset()
    }
  }

  private readonly reset = (): void => {
    this.setState({ error: null })
  }

  override render(): React.ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    const { kind, id, variant = 'block' } = this.props
    const message = crashMessage(kind)

    return (
      <div
        role="alert"
        data-extension-kind={kind}
        data-extension-id={id}
        className={cn(
          'flex gap-2 rounded-md border border-destructive/40 bg-destructive-tint text-foreground',
          variant === 'block'
            ? 'm-3 flex-col items-start p-3'
            : 'items-center px-2.5 py-1.5',
        )}
      >
        <i
          className="fas fa-triangle-exclamation type-icon-m text-destructive-text"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="type-body">{message}</div>
          {variant === 'block' && (
            <div className="mt-1 type-small break-words text-muted-foreground">
              <code className="break-all">{id}</code>: {error.message}
            </div>
          )}
        </div>
        <Button
          variant="outline"
          size={variant === 'block' ? 'sm' : 'xs'}
          title={variant === 'inline' ? `${id}: ${error.message}` : undefined}
          onClick={this.reset}
        >
          {t('extension.retry', 'Try again')}
        </Button>
      </div>
    )
  }
}

interface ShellBoundaryState {
  error: Error | null
}

/**
 * The last line of defence around the whole app: anything no
 * ExtensionBoundary caught (a crash in the shell itself) shows a reload
 * screen instead of a blank page. Deliberately plain - the shell's providers
 * may be what broke.
 */
export class ShellBoundary extends React.Component<
  { children: React.ReactNode },
  ShellBoundaryState
> {
  override state: ShellBoundaryState = { error: null }

  static getDerivedStateFromError(error: unknown): ShellBoundaryState {
    return { error: toError(error) }
  }

  override componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    console.error('Studio crashed:', error, info.componentStack ?? '')
  }

  override render(): React.ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div
        role="alert"
        className="grid h-screen place-items-center bg-background p-7.5 text-foreground"
      >
        <div className="flex max-w-120 flex-col items-start gap-3">
          <div className="type-heading-m">
            {t('shell.crashed.title', 'Studio stopped working')}
          </div>
          <p className="type-body text-muted-foreground">
            {t(
              'shell.crashed.body',
              'Something went wrong and Studio could not continue. Your saved changes are safe; reload to carry on.',
            )}
          </p>
          <code className="type-code-small break-words text-muted-foreground">
            {error.message}
          </code>
          <Button onClick={() => window.location.reload()}>
            {t('shell.crashed.reload', 'Reload Studio')}
          </Button>
        </div>
      </div>
    )
  }
}
