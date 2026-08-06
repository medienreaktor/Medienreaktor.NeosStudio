import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { apiErrorDescription } from '@/api/client'
import { nodeLabel, type NodeDto } from '@/api/nodes'
import {
  createPreviewLink,
  deletePreviewLink,
  usePreviewLinks,
  type PreviewLink,
} from '@/api/previewLinks'
import { queryKeys } from '@/api/keys'
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
import { translate as t } from '@/lib/i18n'

/**
 * Create and manage shareable preview links for the current document: anyone
 * holding the URL sees the page read-only, exactly as a visitor would - no
 * login. The URL is shown exactly once (the secret is stored hashed), so the
 * dialog pushes copying it right after creation; the list below manages
 * (revokes) all of the user's active links.
 */
export function ShareLinkDialog({
  document,
  open,
  onOpenChange,
}: {
  document: NodeDto
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [label, setLabel] = useState('')
  const [ttlHours, setTtlHours] = useState<number>(48)
  const [creating, setCreating] = useState(false)
  const [createdUrl, setCreatedUrl] = useState<string | null>(null)
  const { data } = usePreviewLinks(open)
  const links = data?.links ?? []

  // Fresh form per document and per opening; a URL from a previous round
  // must never linger (it looks current but belongs to another page).
  useEffect(() => {
    if (open) {
      setLabel(nodeLabel(document))
      setCreatedUrl(null)
    }
  }, [open, document])

  const ttlItems = [
    { value: '24', label: t('share.ttl24', '24 hours') },
    { value: '48', label: t('share.ttl48', '2 days') },
    { value: '168', label: t('share.ttl168', '7 days') },
  ]

  const create = async () => {
    setCreating(true)
    try {
      const { link } = await createPreviewLink({
        node: document.address,
        label: label.trim() || nodeLabel(document),
        ttlHours,
      })
      setCreatedUrl(link.shareUrl)
      queryClient.invalidateQueries({ queryKey: queryKeys.previewLinks })
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

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      toast.success(t('share.copied', 'Link copied to the clipboard.'))
    } catch {
      // Clipboard access can be denied; the URL stays visible to copy by hand.
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
      queryClient.invalidateQueries({ queryKey: queryKeys.previewLinks })
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('share.title', 'Share preview link')}</DialogTitle>
          <DialogDescription>
            {t(
              'share.description',
              'Anyone with the link can view this page read-only, without logging in, until the link expires.',
            )}
          </DialogDescription>
        </DialogHeader>

        {createdUrl === null ? (
          <div className="space-y-4">
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
                readOnly
                value={createdUrl}
                onFocus={(event) => event.target.select()}
                className="font-mono text-xs"
              />
              <Button onClick={() => copy(createdUrl)}>
                <i className="fas fa-fw fa-copy" aria-hidden />
                {t('share.copy', 'Copy')}
              </Button>
            </div>
            <p className="text-xs text-neutral-600 dark:text-neutral-400">
              {t(
                'share.copyOnceHint',
                'Copy the link now — for security it is shown only this once.',
              )}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCreatedUrl(null)}
            >
              {t('share.createAnother', 'Create another link')}
            </Button>
          </div>
        )}

        {links.length > 0 && (
          <>
            <Separator />
            <div className="space-y-1">
              <p className="text-sm font-medium">
                {t('share.activeLinks', 'Your active links')}
              </p>
              <ul className="max-h-48 space-y-1 overflow-y-auto">
                {links.map((link) => (
                  <li
                    key={link.id}
                    className="flex items-center gap-2 rounded px-1 py-0.5 pl-2 text-sm hover:bg-neutral-200 dark:hover:bg-neutral-800"
                  >
                    <span
                      className="min-w-0 flex-1 truncate"
                      title={link.label}
                    >
                      {link.label}
                    </span>
                    <span
                      className="shrink-0 text-xs text-neutral-600 dark:text-neutral-400"
                      title={new Date(link.expiresAt).toLocaleString()}
                    >
                      {t('share.expires', 'expires {0}', [
                        new Date(link.expiresAt).toLocaleDateString(),
                      ])}
                    </span>
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
