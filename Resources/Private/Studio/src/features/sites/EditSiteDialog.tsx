import { useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'

import { apiErrorDescription } from '@/api/http/errors'
import { neosKeys } from '@/api/neos/keys'
import {
  createDomain,
  deleteDomain,
  updateDomain,
  updateSite,
} from '@/api/neos/endpoints/sites'
import type { Domain, Site } from '@/api/neos/schema'
import { queryClient } from '@/app/queryClient'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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

/** The domain add/edit form state: creating, or editing one domain. */
type DomainFormState =
  { mode: 'create' } | { mode: 'edit'; domain: Domain } | null

function invalidateSites() {
  void queryClient.invalidateQueries({ queryKey: neosKeys.sites.all })
}

function mutationErrorToast(error: unknown) {
  toast.error(
    apiErrorDescription(
      error,
      t('sites.saveFailedDetail', 'Saving the site failed.'),
    ),
    { title: t('sites.saveFailed', 'Could not save site') },
  )
}

/**
 * Edit a site: display name plus the domain list (add, edit, activate,
 * primary, delete). The parent resolves the site from the live query data, so
 * every domain mutation is reflected here as soon as the listing refetches.
 * Site state (online/offline) is toggled from the row menu, not here.
 */
export function EditSiteDialog({
  site,
  onOpenChange,
}: {
  /** The site being edited; null renders the dialog closed. */
  site: Site | null
  onOpenChange: (open: boolean) => void
}) {
  // The last site shown, so the popup keeps its content while it fades out
  // after `site` went back to null.
  const [shown, setShown] = useState(site)
  if (site !== null && site !== shown) setShown(site)

  return (
    <Dialog open={site !== null} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        {/* Mounted per opening (the popup unmounts while closed) and keyed
            by node name, not the object: the site prop refreshes after every
            domain mutation and must not clobber a half-typed name. */}
        {shown !== null && <EditSiteForm key={shown.nodeName} site={shown} />}
      </DialogContent>
    </Dialog>
  )
}

function EditSiteForm({ site }: { site: Site }) {
  const [name, setName] = useState(() => site.name)
  const [domainForm, setDomainForm] = useState<DomainFormState>(null)
  const [deletingDomain, setDeletingDomain] = useState<Domain | null>(null)

  const nameDirty = name.trim() !== site.name
  const rename = useMutation({
    mutationFn: () => updateSite(site.nodeName, { name: name.trim() }),
    onSuccess: (response) => {
      invalidateSites()
      toast.success(
        t('sites.saved', 'The site "{0}" has been saved.', [response.name]),
      )
    },
    onError: mutationErrorToast,
  })

  const setPrimary = useMutation({
    mutationFn: (domainId: string) =>
      updateSite(site.nodeName, { primaryDomainId: domainId }),
    onSuccess: invalidateSites,
    onError: mutationErrorToast,
  })

  const domainMutation = useMutation({
    mutationFn: ({
      action,
    }: {
      domainId: string
      action: () => Promise<unknown>
    }) => action(),
    onSuccess: invalidateSites,
    onError: mutationErrorToast,
  })
  // No onError: the confirm dialog reports a failure itself, and stays open.
  const domainDeletion = useMutation({
    mutationFn: (domainId: string) => deleteDomain(site.nodeName, domainId),
    onSuccess: invalidateSites,
  })

  /** A row's menu is closed while something is already happening to it. */
  const domainBusy = (domainId: string) =>
    (setPrimary.isPending && setPrimary.variables === domainId) ||
    (domainMutation.isPending &&
      domainMutation.variables?.domainId === domainId) ||
    (domainDeletion.isPending && domainDeletion.variables === domainId)

  const onRenameSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (nameDirty && name.trim() !== '' && !rename.isPending) rename.mutate()
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {t('sites.editSite', 'Edit site')}
          <span className="ml-2 font-normal text-neutral-600 dark:text-neutral-400">
            {site.name}
          </span>
        </DialogTitle>
        <DialogDescription>
          {t('sites.editSiteHint', 'Node name "{0}", package {1}.', [
            site.nodeName,
            site.siteResourcesPackageKey,
          ])}
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={onRenameSubmit} className="flex items-end gap-2">
        <div className="flex-1">
          <Field label={t('sites.name', 'Name')} htmlFor="site-edit-name">
            <Input
              id="site-edit-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="off"
              required
            />
          </Field>
        </div>
        <Button
          type="submit"
          disabled={!nameDirty || name.trim() === '' || rename.isPending}
        >
          {rename.isPending
            ? t('sites.saving', 'Saving…')
            : t('sites.save', 'Save')}
        </Button>
      </form>

      <Separator />

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-neutral-950 dark:text-white">
            {t('sites.domains', 'Domains')}
          </h3>
          {domainForm === null && (
            <Button
              variant="secondary"
              size="xs"
              onClick={() => setDomainForm({ mode: 'create' })}
            >
              <i className="fas fa-plus" aria-hidden />
              {t('sites.addDomain', 'Add domain')}
            </Button>
          )}
        </div>

        {site.domains.length === 0 && domainForm === null && (
          <p className="text-sm text-neutral-500">
            {t(
              'sites.noDomains',
              'No domains configured. The site is reachable under any host pointing at this installation.',
            )}
          </p>
        )}

        <ul className="space-y-1">
          {site.domains.map((domain) => (
            <DomainRow
              key={domain.id}
              domain={domain}
              busy={domainBusy(domain.id)}
              onSetPrimary={() => setPrimary.mutate(domain.id)}
              onToggleActive={() =>
                domainMutation.mutate({
                  domainId: domain.id,
                  action: () =>
                    updateDomain(site.nodeName, domain.id, {
                      active: !domain.active,
                    }),
                })
              }
              onEdit={() => setDomainForm({ mode: 'edit', domain })}
              onDelete={() => setDeletingDomain(domain)}
            />
          ))}
        </ul>

        {domainForm !== null && (
          <DomainForm
            key={domainForm.mode === 'edit' ? domainForm.domain.id : 'new'}
            siteNodeName={site.nodeName}
            editing={domainForm.mode === 'edit' ? domainForm.domain : null}
            onClose={() => setDomainForm(null)}
          />
        )}
      </div>

      <ConfirmDialog
        open={deletingDomain !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingDomain(null)
        }}
        title={t('sites.deleteDomainTitle', 'Delete domain "{0}"?', [
          deletingDomain?.url ?? '',
        ])}
        description={t(
          'sites.deleteDomainDescription',
          'The site is no longer reachable under this domain.',
        )}
        confirmLabel={t('sites.deleteDomain', 'Delete')}
        onConfirm={async () => {
          await domainDeletion.mutateAsync(deletingDomain!.id)
        }}
      />
    </>
  )
}

function DomainRow({
  domain,
  busy,
  onSetPrimary,
  onToggleActive,
  onEdit,
  onDelete,
}: {
  domain: Domain
  /** Something is already happening to this domain - no second action. */
  busy: boolean
  onSetPrimary: () => void
  onToggleActive: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <li className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-sm">
      <span className="flex min-w-0 items-center gap-2">
        <span
          className={
            domain.active
              ? 'truncate text-neutral-800 dark:text-neutral-200'
              : 'truncate text-neutral-500'
          }
        >
          {domain.url}
        </span>
        {domain.isPrimary && (
          <Badge variant="secondary">{t('sites.primary', 'Primary')}</Badge>
        )}
        {!domain.active && (
          <Badge variant="outline">
            {t('sites.inactiveDomain', 'Inactive')}
          </Badge>
        )}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={busy}
              aria-label={t('sites.domainActions', 'Domain actions')}
            />
          }
        >
          <i className="fas fa-ellipsis-vertical" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {/* Neos.Api can move the primary domain but not unset it. Only
              an active domain can become primary. */}
          {!domain.isPrimary && domain.active && (
            <DropdownMenuItem onClick={onSetPrimary}>
              <i className="fas fa-star" aria-hidden />
              {t('sites.setPrimary', 'Set as primary')}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={onToggleActive}>
            <i
              className={`fas ${domain.active ? 'fa-toggle-off' : 'fa-toggle-on'}`}
              aria-hidden
            />
            {domain.active
              ? t('sites.deactivateDomain', 'Deactivate')
              : t('sites.activateDomain', 'Activate')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onEdit}>
            <i className="fas fa-pen" aria-hidden />
            {t('sites.editDomain', 'Edit')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={onDelete}>
            <i className="fas fa-trash" aria-hidden />
            {t('sites.deleteDomain', 'Delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}

/** Inline add/edit form for one domain: hostname, scheme, port. */
function DomainForm({
  siteNodeName,
  editing,
  onClose,
}: {
  siteNodeName: string
  editing: Domain | null
  onClose: () => void
}) {
  const [hostname, setHostname] = useState(editing?.hostname ?? '')
  const [scheme, setScheme] = useState<string>(editing?.scheme ?? 'any')
  const [port, setPort] = useState(editing?.port?.toString() ?? '')

  const schemeItems = [
    { value: 'any', label: t('sites.schemeAny', 'Any scheme') },
    { value: 'http', label: 'http' },
    { value: 'https', label: 'https' },
  ]

  // Empty is "any port" - omitted on create, cleared (null) on update. Anything
  // else must be a valid port, the same for both.
  const portValue = parsePort(port)
  const portInvalid = portValue === undefined
  const canSubmit = hostname.trim() !== '' && !portInvalid

  const mutation = useMutation({
    mutationFn: () => {
      const schemeValue = scheme === 'any' ? null : (scheme as 'http' | 'https')
      const portOrNull = portValue ?? null
      if (editing !== null) {
        // null clears the scheme / port.
        return updateDomain(siteNodeName, editing.id, {
          hostname: hostname.trim(),
          scheme: schemeValue,
          port: portOrNull,
        })
      }
      return createDomain(siteNodeName, {
        hostname: hostname.trim(),
        ...(schemeValue !== null ? { scheme: schemeValue } : {}),
        ...(portOrNull !== null ? { port: portOrNull } : {}),
      })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: neosKeys.sites.all })
      onClose()
    },
    onError: (error) =>
      toast.error(
        apiErrorDescription(
          error,
          t('sites.domainFailedDetail', 'Saving the domain failed.'),
        ),
        { title: t('sites.domainFailed', 'Could not save domain') },
      ),
  })

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (canSubmit && !mutation.isPending) mutation.mutate()
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-3 rounded-md border border-dashed p-3"
    >
      <div className="grid grid-cols-[1fr_8rem_5rem] gap-2">
        <Field
          label={t('sites.hostname', 'Hostname')}
          htmlFor="site-domain-hostname"
        >
          <Input
            id="site-domain-hostname"
            value={hostname}
            onChange={(event) => setHostname(event.target.value)}
            placeholder="www.example.com"
            autoComplete="off"
            required
          />
        </Field>
        <Field label={t('sites.scheme', 'Scheme')} htmlFor="site-domain-scheme">
          <Select
            value={scheme}
            onValueChange={(value) => setScheme(value as string)}
            items={schemeItems}
          >
            <SelectTrigger id="site-domain-scheme" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {schemeItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label={t('sites.port', 'Port')} htmlFor="site-domain-port">
          <Input
            id="site-domain-port"
            type="number"
            min={1}
            max={65535}
            value={port}
            onChange={(event) => setPort(event.target.value)}
            autoComplete="off"
            aria-invalid={portInvalid || undefined}
          />
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          size="xs"
          onClick={onClose}
          disabled={mutation.isPending}
        >
          {t('common.cancel', 'Cancel')}
        </Button>
        <Button
          type="submit"
          size="xs"
          disabled={!canSubmit || mutation.isPending}
        >
          {mutation.isPending
            ? t('sites.saving', 'Saving…')
            : editing !== null
              ? t('sites.saveDomain', 'Save domain')
              : t('sites.addDomain', 'Add domain')}
        </Button>
      </div>
    </form>
  )
}

/** A port field's value: null when empty, undefined when not a valid port. */
function parsePort(text: string): number | null | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const port = Number(trimmed)
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : undefined
}
