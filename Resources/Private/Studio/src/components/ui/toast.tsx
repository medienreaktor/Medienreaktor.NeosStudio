import * as React from 'react'
import { Toast as ToastPrimitive } from '@base-ui/react/toast'

import { translate as t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/**
 * A global toast manager so any code — including non-React modules like the
 * API layer — can raise a toast without threading a hook through props. The
 * same instance is handed to <Toaster /> (the single render point) via the
 * provider's `toastManager` prop.
 */
export const toastManager = ToastPrimitive.createToastManager()

type ToastKind = 'success' | 'error' | 'info' | 'loading'

interface Options {
  /** Bold heading; defaults to a per-kind label ("Success", "Error", …). */
  title?: React.ReactNode
  /**
   * Auto-dismiss delay in ms. `0` keeps the toast until dismissed. Errors
   * default to non-expiring so failures aren't missed.
   */
  timeout?: number
  /** Stable id — re-raising with the same id updates the toast in place. */
  id?: string
}

// Thunks, not plain strings: resolved at call time so the translation bundle
// (loaded at boot, after this module is imported) is in place when a toast is
// actually raised.
const DEFAULT_TITLES: Record<ToastKind, () => string> = {
  success: () => t('common.toastSuccess', 'Success'),
  error: () => t('common.toastError', 'Error'),
  info: () => t('common.toastInfo', 'Notice'),
  loading: () => t('common.toastLoading', 'Working…'),
}

function raise(kind: ToastKind, message: React.ReactNode, options?: Options) {
  return toastManager.add({
    type: kind,
    title: options?.title ?? DEFAULT_TITLES[kind](),
    description: message,
    // Errors stay until dismissed; the rest auto-expire on the provider default.
    timeout: options?.timeout ?? (kind === 'error' ? 0 : undefined),
    priority: kind === 'error' ? 'high' : 'low',
    id: options?.id,
  })
}

/** Unwrap Errors/unknowns thrown from catch blocks into a readable string. */
function toMessage(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.message
  return String(value)
}

/**
 * App-wide toast API. Prefer these over inline error/success messages.
 *
 *   toast.success('Saved.')
 *   toast.error('Publishing failed', { title: 'Publish' })
 *   toast.error(err)  // Error objects / unknowns are unwrapped to a message
 */
export const toast = {
  success: (message: React.ReactNode, options?: Options) =>
    raise('success', message, options),
  info: (message: React.ReactNode, options?: Options) =>
    raise('info', message, options),
  loading: (message: React.ReactNode, options?: Options) =>
    raise('loading', message, { timeout: 0, ...options }),
  error: (message: unknown, options?: Options) =>
    raise(
      'error',
      React.isValidElement(message) ? message : toMessage(message),
      options,
    ),
  dismiss: (id?: string) => toastManager.close(id),
  update: (id: string, options: Parameters<typeof toastManager.update>[1]) =>
    toastManager.update(id, options),
  /** Drive a toast through loading → success/error from a promise. */
  promise: <Value,>(
    promise: Promise<Value>,
    options: Parameters<typeof toastManager.promise<Value>>[1],
  ) => toastManager.promise(promise, options),
}

const ICONS: Record<string, React.ReactNode> = {
  success: (
    <i
      className="fas fa-circle-check text-[1rem] shrink-0 text-green-500"
      aria-hidden
    />
  ),
  error: (
    <i
      className="fas fa-triangle-exclamation text-[1rem] shrink-0 text-red-500"
      aria-hidden
    />
  ),
  info: (
    <i
      className="fas fa-circle-info text-[1rem] shrink-0 text-blue-500"
      aria-hidden
    />
  ),
  loading: (
    <i
      className="fas fa-spinner fa-spin text-[1rem] shrink-0 text-neutral-600 dark:text-neutral-400"
      aria-hidden
    />
  ),
}

function ToastList() {
  const { toasts } = ToastPrimitive.useToastManager()

  return toasts.map((toast) => (
    <ToastPrimitive.Root
      key={toast.id}
      toast={toast}
      // Base UI drives the stacking/swipe geometry through these CSS vars; the
      // `after` gap keeps the collapsed stack hoverable between toasts.
      className={cn(
        'absolute right-0 bottom-0 left-auto w-full rounded-lg border bg-neutral-100 dark:bg-neutral-900 p-4 pr-8 text-neutral-950 dark:text-white shadow-lg select-none',
        'z-[calc(1000-var(--toast-index))] transform-[translateX(var(--toast-swipe-movement-x))_translateY(calc(var(--toast-swipe-movement-y)+calc(min(var(--toast-index),10)*-15px)))_scale(calc(max(0,1-(var(--toast-index)*0.1))))]',
        'transition-all [transition-property:transform,opacity] duration-300 ease-out',
        "after:absolute after:bottom-full after:left-0 after:h-4.25 after:w-full after:content-['']",
        'data-expanded:transform-[translateX(var(--toast-swipe-movement-x))_translateY(calc(var(--toast-offset-y)*-1+calc(var(--toast-index)*-1rem)+var(--toast-swipe-movement-y)))]',
        'data-starting-style:transform-[translateY(150%)] data-ending-style:transform-[translateY(150%)] data-ending-style:opacity-0',
        'data-limited:opacity-0',
      )}
    >
      <div className="flex items-start gap-2.5">
        {ICONS[toast.type ?? 'info'] ?? ICONS.info}
        <div className="flex min-w-0 flex-col gap-1">
          {toast.title && (
            <ToastPrimitive.Title className="text-sm leading-tight font-medium" />
          )}
          {toast.description && (
            <ToastPrimitive.Description className="text-sm leading-snug wrap-break-word text-neutral-600 dark:text-neutral-400" />
          )}
          {toast.actionProps && (
            <ToastPrimitive.Action className="mt-1 inline-flex h-7 w-fit items-center rounded-md border px-2.5 text-xs font-medium transition-colors hover:bg-neutral-200 dark:hover:bg-neutral-800" />
          )}
        </div>
      </div>
      <ToastPrimitive.Close
        aria-label={t('common.close', 'Close')}
        className="absolute top-3 right-3 rounded-xs text-neutral-600 dark:text-neutral-400 opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
      >
        <i className="fas fa-xmark text-[1rem]" aria-hidden />
      </ToastPrimitive.Close>
    </ToastPrimitive.Root>
  ))
}

/**
 * Single render point for all toasts. Mount once, high in the tree. The
 * provider shares the global {@link toastManager} so `toast.*` calls made
 * anywhere land here.
 */
export function Toaster({
  timeout = 5000,
  limit = 4,
}: {
  timeout?: number
  limit?: number
}) {
  return (
    <ToastPrimitive.Provider
      toastManager={toastManager}
      timeout={timeout}
      limit={limit}
    >
      <ToastPrimitive.Portal>
        <ToastPrimitive.Viewport className="fixed right-4 bottom-4 z-300 flex w-[calc(100%-2rem)] max-w-sm sm:w-96">
          <ToastList />
        </ToastPrimitive.Viewport>
      </ToastPrimitive.Portal>
    </ToastPrimitive.Provider>
  )
}
