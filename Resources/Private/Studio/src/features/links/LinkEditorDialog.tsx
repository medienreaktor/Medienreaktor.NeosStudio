import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { translate as t } from '@/lib/i18n'
import type { LinkValue } from './linkValue'
import { useLinkTypes, type LinkTypeDefinition } from './registry'

/**
 * The Link Editor: one modal for every place a link is created or edited -
 * the inspector's LinkEditor properties and the rich-text editors in the
 * preview. The tabs are the registered link types (see registry.ts: document,
 * asset, external URL, e-mail built in; plugins add their own); below them sit
 * the options every link type shares (open in new window, CSS class, title,
 * nofollow), offered when the host can store them (`withOptions`) - an inline
 * <a> carries them as attributes, a string-typed node property only holds the
 * href.
 *
 * State seeds once on mount from `value` - hosts mount the dialog per editing
 * session (`{open && <LinkEditorDialog ...>}`), so every session starts
 * fresh. Apply/Remove only report; closing is the host's move (it usually
 * unmounts the dialog). Dismissal (Esc, backdrop, X, Cancel) reports through
 * onOpenChange(false).
 */
export function LinkEditorDialog({
  open,
  onOpenChange,
  subject,
  value,
  withOptions,
  onApply,
  onRemove,
}: {
  open: boolean
  /** Called with false when the dialog is dismissed without a result. */
  onOpenChange: (open: boolean) => void
  /** What the link is for, named in the title (e.g. the property label). */
  subject?: string
  /** The link being edited, or null when creating a new one. */
  value: LinkValue | null
  /** Whether the host can store the shared link options (target, class, ...). */
  withOptions: boolean
  onApply: (value: LinkValue) => void
  /** Offered as a "Remove link" button when set and an existing link is edited. */
  onRemove?: () => void
}) {
  const types = useLinkTypes()
  const [activeId, setActiveId] = useState<string>(
    () => matchType(types, value)?.id ?? '',
  )
  // One href draft per tab, seeded with the edited link's href on its own
  // tab: switching tabs keeps each tab's progress, and Apply takes the
  // active tab's draft.
  const [drafts, setDrafts] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(
      types.map((type) => [
        type.id,
        value !== null && type.matches(value.href) ? value.href : null,
      ]),
    ),
  )
  const [targetBlank, setTargetBlank] = useState(value?.target === '_blank')
  const [nofollow, setNofollow] = useState(() =>
    /(^|\s)nofollow(\s|$)/.test(value?.rel ?? ''),
  )
  const [cssClass, setCssClass] = useState(value?.cssClass ?? '')
  const [title, setTitle] = useState(value?.title ?? '')

  const href = drafts[activeId] ?? null

  const apply = () => {
    if (href === null || href === '') return
    onApply({
      href,
      target: targetBlank ? '_blank' : null,
      rel: nofollow ? 'nofollow' : null,
      cssClass: cssClass.trim() === '' ? null : cssClass.trim(),
      title: title.trim() === '' ? null : title.trim(),
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>
            {value !== null
              ? t('link.edit', 'Edit link')
              : t('link.insert', 'Insert link')}
          </DialogTitle>
          <DialogDescription>
            {t('link.chooseLink', 'Choose the link')}
            {subject ? ` ${t('link.for', 'for')} ` : ''}
            {subject && <strong>{subject}</strong>}
            {withOptions
              ? ` ${t('link.andBehaves', 'and how the link behaves')}`
              : ''}
            .
          </DialogDescription>
        </DialogHeader>

        {types.length === 0 ? (
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            {t('link.noTypes', 'No link types are registered.')}
          </p>
        ) : (
          <Tabs
            value={activeId}
            onValueChange={(next) => setActiveId(String(next))}
          >
            <TabsList>
              {types.map((type) => (
                <TabsTrigger key={type.id} value={type.id}>
                  {type.icon}
                  {type.label}
                </TabsTrigger>
              ))}
            </TabsList>
            {types.map((type) => (
              <TabsContent
                key={type.id}
                value={type.id}
                // flex-none is load-bearing: the base flex-1 has basis 0%,
                // which an auto-height flex column resolves as "content", so
                // the panel would grow with the expanded document tree and
                // blow the dialog past the viewport instead of honoring h-80.
                className="h-80 max-h-[50vh] min-h-0 flex-none p-3"
              >
                <type.component
                  href={drafts[type.id] ?? null}
                  onChange={(next) =>
                    setDrafts((previous) => ({ ...previous, [type.id]: next }))
                  }
                />
              </TabsContent>
            ))}
          </Tabs>
        )}

        {withOptions && (
          <fieldset className="grid grid-cols-2 gap-x-4 gap-y-3">
            <legend className="sr-only">
              {t('link.options', 'Link options')}
            </legend>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox
                checked={targetBlank}
                onCheckedChange={(next) => setTargetBlank(next)}
              />
              {t('link.openNewWindow', 'Open in new window')}
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox
                checked={nofollow}
                onCheckedChange={(next) => setNofollow(next)}
              />
              {t('link.nofollow', 'No follow (rel="nofollow")')}
            </label>
            <label className="flex flex-col gap-1 text-xs text-neutral-600 dark:text-neutral-400">
              {t('link.cssClass', 'CSS class')}
              <Input
                value={cssClass}
                onChange={(event) => setCssClass(event.target.value)}
                placeholder={t('link.cssClassPlaceholder', 'e.g. button')}
                className="h-8 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-neutral-600 dark:text-neutral-400">
              {t('link.title', 'Title')}
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={t('link.titlePlaceholder', 'Shown as tooltip')}
                className="h-8 text-sm"
              />
            </label>
          </fieldset>
        )}

        <DialogFooter>
          {onRemove && value !== null && (
            <Button
              variant="outline"
              className="text-red-500 sm:mr-auto"
              onClick={onRemove}
            >
              {t('link.remove', 'Remove link')}
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('link.cancel', 'Cancel')}
          </Button>
          <Button disabled={href === null || href === ''} onClick={apply}>
            {t('link.apply', 'Apply')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The tab an edited value opens on: its type's tab, or the first tab for a new link. */
function matchType(
  types: LinkTypeDefinition[],
  value: LinkValue | null,
): LinkTypeDefinition | undefined {
  if (value === null) return types[0]
  return (
    types.find((type) => type.matches(value.href)) ??
    types.find((type) => type.isFallback) ??
    types[0]
  )
}
