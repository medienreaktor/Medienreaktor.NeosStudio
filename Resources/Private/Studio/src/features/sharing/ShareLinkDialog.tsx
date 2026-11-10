import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { apiErrorDescription } from '@/api/http/errors'
import type { Node } from '@/api/neos/schema'
import {
  createPreviewLink,
  deletePreviewLink,
  usePreviewLinks,
} from '@/api/studio/endpoints/previewLinks'
import { studioKeys } from '@/api/studio/keys'
import type { PreviewLink } from '@/api/studio/schema'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { toast } from '@/components/ui/toast'
import { copyText } from '@/lib/clipboard'
import { translate as t } from '@/lib/i18n'

function documentLabel(document: Node): string {
  return document.label || document.nodeAggregateId
}

/**
 * Create and manage shareable preview links for the current document: anyone
 * holding the URL sees the page read-only, including hidden content - no
 * login. The new link's URL is shown right after creation; the list below
 * lets the user copy any of their active links again and revoke them. Links
 * from before the server kept their secret have no URL any more (shareUrl
 * null) - those can only be revoked.
 *
 * Copying can be refused - Safari sometimes doesn't count a click as user
 * activation, which both clipboard paths require. Then the URL is shown
 * selected in the field, so the keyboard shortcut (always allowed) copies it.
 */
export function ShareLinkDialog({
  document,
  open,
  onOpenChange,
}: {
  document: Node
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  // Seeded once: mounted per opening and per document (see ShareButton), so a
  // refetch of the document never resets the form - nor drops the URL shown
  // (the link just created, or one whose copying failed).
  const [label, setLabel] = useState(() => documentLabel(document))
  const [ttlHours, setTtlHours] = useState<number>(48)
  const [creating, setCreating] = useState(false)
  const [shownUrl, setShownUrl] = useState<string | null>(null)
  // Bumped when copying fails: selects the URL field once it shows that URL.
  const [selectRequest, setSelectRequest] = useState(0)
  const urlInputRef = useRef<HTMLInputElement>(null)
  const { data } = usePreviewLinks(open)
  const links = data ?? []

  useEffect(() => {
    if (selectRequest === 0) return
    urlInputRef.current?.focus()
    urlInputRef.current?.select()
  }, [selectRequest])

  const ttlItems = [
    { value: '24', label: t('share.ttl24', '24 hours') },
    { value: '48', label: t('share.ttl48', '2 days') },
    { value: '168', label: t('share.ttl168', '7 days') },
    { value: '720', label: t('share.ttl720', '30 days') },
    // 365 days, not P1Y: stays under the server's maxLifetime in leap years too
    { value: '8760', label: t('share.ttl8760', '1 year') },
  ]

  const create = async () => {
    setCreating(true)
    try {
      const link = await createPreviewLink(document, {
        label: label.trim() || documentLabel(document),
        ttlHours,
      })
      setShownUrl(link.shareUrl)
      void queryClient.invalidateQueries({ queryKey: studioKeys.previewLinks })
    } catch (e) {
      toast.error(
        apiErrorDescription(
          e,
          t('share.createFailed', 'Creating the preview link failed.'),
        ),
      )
    } finally {
      setCreating(false)
    }
  }

  const copy = async (url: string, trigger: HTMLElement) => {
    try {
      await copyText(url, trigger)
      toast.success(t('share.copied', 'Link copied to the clipboard.'))
    } catch {
      // Clipboard access can be denied: show the URL selected, for the
      // keyboard shortcut.
      setShownUrl(url)
      setSelectRequest((request) => request + 1)
      toast.error(
        t(
          'share.copyFailed',
          'Copying failed — please copy the link manually.',
        ),
      )
    }
  }

  const revoke = async (link: PreviewLink) => {
    try {
      await deletePreviewLink(link.id)
      toast.success(t('share.revoked', 'The preview link was revoked.'))
      void queryClient.invalidateQueries({ queryKey: studioKeys.previewLinks })
    } catch (e) {
      toast.error(
        apiErrorDescription(
          e,
          t('share.revokeFailed', 'Revoking the preview link failed.'),
        ),
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-120">
        <DialogHeader>
          <DialogTitle>{t('share.title', 'Share preview link')}</DialogTitle>
          <DialogDescription>
            {t(
              'share.description',
              'Anyone with the link can view this page read-only, without logging in, until the link expires.',
            )}
          </DialogDescription>
        </DialogHeader>

        {shownUrl === null ? (
          <div className="space-y-3.5">
            <Field label={t('share.label', 'Label')} htmlFor="share-label">
              <Input
                id="share-label"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                autoComplete="off"
              />
            </Field>
            <Field
              label={t('share.expiry', 'Expires after')}
              htmlFor="share-ttl"
            >
              {/* Select trigger and button share one flex row, so the two
                  h-9 controls align exactly (items-end across the Field
                  wrapper did not - the select renders hidden form elements
                  below the trigger that shift the bottom edge). */}
              <div className="flex gap-3">
                <Select
                  value={String(ttlHours)}
                  onValueChange={(value) => setTtlHours(Number(value))}
                  items={ttlItems}
                >
                  <SelectTrigger id="share-ttl" className="flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ttlItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button onClick={create} disabled={creating}>
                  {creating
                    ? t('share.creating', 'Creating…')
                    : t('share.create', 'Create link')}
                </Button>
              </div>
            </Field>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex gap-2">
              <Input
                ref={urlInputRef}
                readOnly
                value={shownUrl}
                onFocus={(event) => event.target.select()}
                className="type-code-small"
              />
              <Button onClick={(event) => copy(shownUrl, event.currentTarget)}>
                <i className="fas fa-fw fa-copy" aria-hidden />
                {t('share.copy', 'Copy')}
              </Button>
            </div>
            <p className="type-small text-muted-foreground">
              {t(
                'share.copyLaterHint',
                'You can copy it again later from your active links.',
              )}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShownUrl(null)}
            >
              {t('share.createAnother', 'Create another link')}
            </Button>
          </div>
        )}

        {links.length > 0 && (
          <>
            <Separator />
            <div className="space-y-1">
              <p className="type-body-strong">
                {t('share.activeLinks', 'Your active links')}
              </p>
              <ul className="max-h-45 space-y-1 overflow-y-auto">
                {links.map((link) => (
                  <li
                    key={link.id}
                    className="flex items-center gap-2 rounded px-1 py-0.5 pl-2 type-body hover:bg-accent"
                  >
                    <span
                      className="min-w-0 flex-1 truncate"
                      title={link.label}
                    >
                      {link.label}
                    </span>
                    <span
                      className="shrink-0 type-small text-muted-foreground"
                      title={new Date(link.expiresAt).toLocaleString()}
                    >
                      {t('share.expires', 'expires {0}', [
                        new Date(link.expiresAt).toLocaleDateString(),
                      ])}
                    </span>
                    {link.shareUrl !== null ? (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={(event) =>
                          link.shareUrl &&
                          copy(link.shareUrl, event.currentTarget)
                        }
                        title={t('share.copy', 'Copy')}
                        aria-label={t('share.copy', 'Copy')}
                      >
                        <i className="fas fa-fw fa-copy" aria-hidden />
                      </Button>
                    ) : (
                      <span
                        className="inline-flex size-7.5 shrink-0 items-center justify-center text-muted-foreground"
                        title={t(
                          'share.notRecoverable',
                          'This link was created before links could be copied again. It still works, but its URL can no longer be shown.',
                        )}
                      >
                        <i className="fas fa-fw fa-circle-info" aria-hidden />
                      </span>
                    )}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => revoke(link)}
                      title={t('share.revoke', 'Revoke link')}
                    >
                      <i className="fas fa-fw fa-trash-can" aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
