import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'

import { apiErrorDescription } from '@/api/client'
import { queryKeys } from '@/api/keys'
import { deleteSite, updateSite, useSites, type Site } from '@/api/sites'
import { queryClient } from '@/app/queryClient'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Placeholder } from '@/components/ui/placeholder'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { toast } from '@/components/ui/toast'
import { translate as t } from '@/lib/i18n'
import { SettingsHeader } from '@/features/modals/SettingsHeader'
import { CreateSiteDialog } from './CreateSiteDialog'
import { EditSiteDialog } from './EditSiteDialog'

/**
 * Sites administration, rendered as a section of the shared Settings modal
 * (see features/modals). Replaces the classic Sites backend module: create
 * sites, edit name and domains, take sites on- and offline, delete.
 *
 * Administrators only - the host disables the subnav entry for non-admins
 * (me.permissions.sites) and every write endpoint 403s without the
 * Administrator role. The listing itself is the same /sites endpoint the site
 * switcher uses (fixed to the live workspace here); offline sites are
 * included and marked.
 */
export function SitesAdministration() {
  const { data, isLoading, error } = useSites('live', null)
  const [creating, setCreating] = useState(false)
  // The edited/deleted site is tracked by node name and resolved from the
  // live query data, so domain mutations refresh the open dialog.
  const [editingNodeName, setEditingNodeName] = useState<string | null>(null)
  const [deletingNodeName, setDeletingNodeName] = useState<string | null>(null)

  useEffect(() => {
    if (error)
      toast.error(error, {
        title: t('sites.loadFailed', 'Could not load sites'),
      })
  }, [error])

  const sites = data?.sites ?? []
  const editing = sites.find((s) => s.nodeName === editingNodeName) ?? null
  const deleting = sites.find((s) => s.nodeName === deletingNodeName) ?? null

  return (
    <div className="p-6">
      <SettingsHeader
        title={t('sites.title', 'Sites')}
        subtitle={t('sites.subtitle', 'Websites served by this installation.')}
      >
        <Button onClick={() => setCreating(true)}>
          <i className="fas fa-plus" aria-hidden />
          {t('sites.newSite', 'New site')}
        </Button>
      </SettingsHeader>

      {error && (
        <Placeholder
          icon="fa-triangle-exclamation"
          title={t('sites.unavailable', 'Sites are currently unavailable.')}
          className="py-10"
        />
      )}

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      )}

      {data && sites.length === 0 && (
        <Placeholder
          icon="fa-globe"
          title={t('sites.none', 'No sites found.')}
          className="py-10"
        />
      )}

      {data && sites.length > 0 && (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>{t('sites.columnName', 'Name')}</TableHead>
                <TableHead>{t('sites.columnPackage', 'Package')}</TableHead>
                <TableHead>{t('sites.columnDomains', 'Domains')}</TableHead>
                <TableHead>{t('sites.columnStatus', 'Status')}</TableHead>
                <TableHead>
                  <span className="sr-only">
                    {t('sites.columnActions', 'Actions')}
                  </span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sites.map((site) => (
                <SiteRow
                  key={site.nodeName}
                  site={site}
                  onEdit={() => setEditingNodeName(site.nodeName)}
                  onDelete={() => setDeletingNodeName(site.nodeName)}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <CreateSiteDialog open={creating} onOpenChange={setCreating} />
      <EditSiteDialog
        site={editing}
        onOpenChange={(open) => {
          if (!open) setEditingNodeName(null)
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingNodeName(null)
        }}
        title={t('sites.deleteTitle', 'Delete site "{0}"?', [
          deleting?.name ?? '',
        ])}
        description={t(
          'sites.deleteDescription',
          'The site, all of its content in every workspace, its domains and its asset collection are removed permanently. This cannot be undone.',
        )}
        confirmLabel={t('sites.delete', 'Delete site')}
        onConfirm={async () => {
          const site = deleting!
          await deleteSite(site.nodeName)
          queryClient.invalidateQueries({ queryKey: queryKeys.sitesAll })
          // Content is gone with the site - the trees must not show it.
          queryClient.invalidateQueries({ queryKey: queryKeys.nodes.all })
          toast.success(
            t('sites.deleted', 'The site "{0}" has been deleted.', [site.name]),
          )
        }}
      />
    </div>
  )
}

function SiteRow({
  site,
  onEdit,
  onDelete,
}: {
  site: Site
  onEdit: () => void
  onDelete: () => void
}) {
  const stateMutation = useMutation({
    mutationFn: (state: 'online' | 'offline') =>
      updateSite(site.nodeName, { state }),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sitesAll })
      toast.success(
        response.site.state === 'online'
          ? t('sites.wentOnline', 'The site "{0}" is now online.', [
              response.site.name,
            ])
          : t('sites.wentOffline', 'The site "{0}" is now offline.', [
              response.site.name,
            ]),
      )
    },
    onError: (error) =>
      toast.error(
        apiErrorDescription(
          error,
          t('sites.stateFailedDetail', 'Changing the status failed.'),
        ),
        { title: t('sites.stateFailed', 'Could not change status') },
      ),
  })

  return (
    <TableRow className="text-neutral-200">
      <TableCell>
        <span className="font-medium text-white">{site.name}</span>
        <span className="ml-2 text-xs text-neutral-500">{site.nodeName}</span>
      </TableCell>
      <TableCell className="text-neutral-400">
        {site.siteResourcesPackageKey}
      </TableCell>
      <TableCell>
        {site.domains.length === 0 ? (
          <span className="text-neutral-500">—</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {site.domains.map((domain) => (
              <Badge
                key={domain.id}
                variant={domain.isPrimary ? 'secondary' : 'outline'}
                className={domain.active ? undefined : 'opacity-50'}
              >
                {domain.hostname}
              </Badge>
            ))}
          </div>
        )}
      </TableCell>
      <TableCell>
        {site.state === 'online' ? (
          <span className="inline-flex items-center gap-1.5 text-neutral-300">
            <span className="size-1.5 rounded-full bg-green-500" />
            {t('sites.online', 'Online')}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-neutral-500">
            <span className="size-1.5 rounded-full bg-neutral-600" />
            {t('sites.offline', 'Offline')}
          </span>
        )}
      </TableCell>
      <TableCell className="w-10 text-right">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('sites.rowActions', 'Site actions')}
              />
            }
          >
            <i className="fas fa-ellipsis-vertical" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onEdit}>
              <i className="fas fa-pen" aria-hidden />
              {t('sites.edit', 'Edit')}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={stateMutation.isPending}
              onClick={() =>
                stateMutation.mutate(
                  site.state === 'online' ? 'offline' : 'online',
                )
              }
            >
              <i
                className={`fas ${site.state === 'online' ? 'fa-eye-slash' : 'fa-eye'}`}
                aria-hidden
              />
              {site.state === 'online'
                ? t('sites.takeOffline', 'Take offline')
                : t('sites.putOnline', 'Put online')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <i className="fas fa-trash" aria-hidden />
              {t('sites.delete', 'Delete site')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  )
}
