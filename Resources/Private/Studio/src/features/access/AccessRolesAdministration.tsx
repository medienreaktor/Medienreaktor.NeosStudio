import { useEffect, useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'

import {
  deleteAccessRole,
  updateAccessRole,
  useAccessRoles,
  type AccessRole,
} from '@/api/accessRoles'
import { apiErrorDescription } from '@/api/client'
import { queryKeys } from '@/api/keys'
import { useUsers } from '@/api/users'
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
import { SearchInput } from '@/components/ui/search-input'
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
import { AccessRoleDialog } from './AccessRoleDialog'
import { constraintSummary } from './summary'

/**
 * Access-role administration, rendered as a section of the shared Settings
 * modal (see features/modals). This is the Studio's answer to what the
 * classic distributions solved with Sandstorm.NeosAcl: name a set of
 * restrictions - sites, page-tree branches, dimensions, workspaces - and
 * assign people to it, without touching Policy.yaml or deploying anything.
 *
 * Administrators only: the host disables the subnav entry without
 * me.permissions.accessRoles and every endpoint 403s anyway. Administrators
 * are also exempt from access control by design, which is why they can never
 * be members - the dialog refuses it and so does the server.
 */
export function AccessRolesAdministration() {
  const { data, isLoading, error } = useAccessRoles()
  const { data: usersData } = useUsers()
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<AccessRole | null>(null)

  useEffect(() => {
    if (error)
      toast.error(error, {
        title: t('accessRoles.loadFailed', 'Could not load access roles'),
      })
  }, [error])

  const roles = useMemo(() => {
    const all = data?.roles ?? []
    const term = search.trim().toLowerCase()
    if (term === '') return all
    return all.filter((role) =>
      [role.label, role.identifier, role.description]
        .join(' ')
        .toLowerCase()
        .includes(term),
    )
  }, [data, search])

  // Resolved from the live listing, so a rename inside the dialog is reflected
  // in the row behind it without extra state.
  const editing = data?.roles.find((role) => role.id === editingId) ?? null
  const userLabels = new Map(
    (usersData?.users ?? []).map((user) => [
      user.id,
      user.fullName || user.label,
    ]),
  )

  return (
    <div className="p-6">
      <SettingsHeader
        title={t('accessRoles.title', 'Access roles')}
        subtitle={t(
          'accessRoles.subtitle',
          'Restrict what editors reach: sites, page-tree branches, dimensions and workspaces.',
        )}
      >
        <Button onClick={() => setCreating(true)}>
          <i className="fas fa-plus" aria-hidden />
          {t('accessRoles.newRole', 'New role')}
        </Button>
      </SettingsHeader>

      {data && !data.enforcedInContentRepository && (
        <div className="mb-4 flex items-start gap-2.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
          <i className="fas fa-triangle-exclamation mt-0.5" aria-hidden />
          <span>
            {t(
              'accessRoles.enforcementOff',
              'Enforcement in the content repository is switched off — these roles shape the editing UI, but do not block direct API requests.',
            )}
          </span>
        </div>
      )}

      {error && (
        <Placeholder
          icon="fa-triangle-exclamation"
          title={t(
            'accessRoles.unavailable',
            'Access roles are currently unavailable.',
          )}
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

      {data && (
        <>
          <SearchInput
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('accessRoles.search', 'Search roles…')}
            wrapperClassName="mb-3 max-w-xs"
          />

          {roles.length === 0 ? (
            <Placeholder
              icon="fa-user-shield"
              title={
                search.trim() !== ''
                  ? t('accessRoles.noMatches', 'No roles match your search.')
                  : t(
                      'accessRoles.none',
                      'No access roles yet. Everyone works unrestricted until you create one.',
                    )
              }
              className="py-10"
            />
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>{t('accessRoles.columnName', 'Role')}</TableHead>
                    <TableHead>
                      {t('accessRoles.columnScope', 'Restrictions')}
                    </TableHead>
                    <TableHead>
                      {t('accessRoles.columnMembers', 'Members')}
                    </TableHead>
                    <TableHead>
                      {t('accessRoles.columnStatus', 'Status')}
                    </TableHead>
                    <TableHead>
                      <span className="sr-only">
                        {t('accessRoles.columnActions', 'Actions')}
                      </span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {roles.map((role) => (
                    <RoleRow
                      key={role.id}
                      role={role}
                      userLabels={userLabels}
                      onEdit={() => setEditingId(role.id)}
                      onDelete={() => setDeleting(role)}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}

      <AccessRoleDialog
        open={creating}
        role={null}
        onOpenChange={setCreating}
      />
      <AccessRoleDialog
        open={editing !== null}
        role={editing}
        onOpenChange={(open) => {
          if (!open) setEditingId(null)
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        title={t('accessRoles.deleteTitle', 'Delete role "{0}"?', [
          deleting?.label ?? '',
        ])}
        description={t(
          'accessRoles.deleteDescription',
          'The role and its memberships are removed. Its members keep their Neos roles and simply stop being restricted by it.',
        )}
        confirmLabel={t('accessRoles.delete', 'Delete role')}
        onConfirm={async () => {
          const role = deleting!
          await deleteAccessRole(role.id)
          queryClient.invalidateQueries({ queryKey: queryKeys.accessAll })
          toast.success(
            t('accessRoles.deleted', 'The role "{0}" has been deleted.', [
              role.label,
            ]),
          )
        }}
      />
    </div>
  )
}

function RoleRow({
  role,
  userLabels,
  onEdit,
  onDelete,
}: {
  role: AccessRole
  userLabels: Map<string, string>
  onEdit: () => void
  onDelete: () => void
}) {
  const activation = useMutation({
    mutationFn: (active: boolean) => updateAccessRole(role.id, { active }),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.accessAll })
      toast.success(
        response.role.active
          ? t('accessRoles.activated', 'The role "{0}" is active again.', [
              response.role.label,
            ])
          : t(
              'accessRoles.deactivated',
              'The role "{0}" is paused — it no longer restricts its members.',
              [response.role.label],
            ),
      )
    },
    onError: (error) =>
      toast.error(
        apiErrorDescription(
          error,
          t(
            'accessRoles.activationFailedDetail',
            'Changing the status failed.',
          ),
        ),
        { title: t('accessRoles.activationFailed', 'Could not change status') },
      ),
  })

  const summary = constraintSummary(role.constraints)
  const memberNames = role.memberUserIds
    .map((id) => userLabels.get(id))
    .filter((label): label is string => label !== undefined)

  return (
    <TableRow className="text-neutral-800 dark:text-neutral-200">
      <TableCell>
        <span className="font-medium text-neutral-950 dark:text-white">
          {role.label}
        </span>
        <div className="text-xs text-neutral-500">{role.identifier}</div>
      </TableCell>
      <TableCell>
        {summary.length === 0 ? (
          <span className="text-neutral-500">
            {t('accessRoles.unrestricted', 'Unrestricted')}
          </span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {summary.map((entry) => (
              <Badge key={entry.key} variant="secondary" title={entry.detail}>
                <i className={`fas ${entry.icon} text-[0.7em]`} aria-hidden />
                {entry.label}
              </Badge>
            ))}
          </div>
        )}
      </TableCell>
      <TableCell>
        {role.memberUserIds.length === 0 ? (
          <span className="text-neutral-500">—</span>
        ) : (
          <span title={memberNames.join(', ')}>
            {t('accessRoles.memberCount', '{0} member(s)', [
              String(role.memberUserIds.length),
            ])}
          </span>
        )}
      </TableCell>
      <TableCell>
        {role.active ? (
          <span className="inline-flex items-center gap-1.5 text-neutral-700 dark:text-neutral-300">
            <span className="size-1.5 rounded-full bg-green-500" />
            {t('accessRoles.active', 'Active')}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-neutral-500">
            <span className="size-1.5 rounded-full bg-neutral-400 dark:bg-neutral-600" />
            {t('accessRoles.paused', 'Paused')}
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
                aria-label={t('accessRoles.rowActions', 'Role actions')}
              />
            }
          >
            <i className="fas fa-ellipsis-vertical" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onEdit}>
              <i className="fas fa-pen" aria-hidden />
              {t('accessRoles.edit', 'Edit')}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={activation.isPending}
              onClick={() => activation.mutate(!role.active)}
            >
              <i
                className={`fas ${role.active ? 'fa-pause' : 'fa-play'}`}
                aria-hidden
              />
              {role.active
                ? t('accessRoles.pause', 'Pause')
                : t('accessRoles.resume', 'Resume')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <i className="fas fa-trash" aria-hidden />
              {t('accessRoles.delete', 'Delete role')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  )
}
