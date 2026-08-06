import { useEffect, useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'

import { apiErrorDescription } from '@/api/client'
import { queryKeys } from '@/api/keys'
import { deleteUser, updateUser, useUsers, type User } from '@/api/users'
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
import { CreateUserDialog } from './CreateUserDialog'
import { EditUserDialog } from './EditUserDialog'
import { ResetPasswordDialog } from './ResetPasswordDialog'

/**
 * User administration, rendered as a section of the shared Settings modal
 * (see features/modals). Replaces the classic Neos Users backend module:
 * create users, edit details and roles, reset passwords, (de)activate and
 * delete.
 *
 * The section is administrators only - the host disables its subnav entry for
 * non-admins (me.permissions.users), and every write endpoint 403s without
 * the Administrator role anyway. Self-lockout operations (deactivate, delete,
 * dropping the own Administrator role) are disabled in the UI and refused by
 * the server.
 */
export function UserAdministration() {
  const { data, isLoading, error } = useUsers()
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<User | null>(null)
  const [resetting, setResetting] = useState<User | null>(null)
  const [deleting, setDeleting] = useState<User | null>(null)

  useEffect(() => {
    if (error)
      toast.error(error, {
        title: t('users.loadFailed', 'Could not load users'),
      })
  }, [error])

  const users = useMemo(() => {
    const all = data?.users ?? []
    const term = search.trim().toLowerCase()
    if (term === '') return all
    return all.filter((user) =>
      [
        user.fullName,
        user.label,
        user.email ?? '',
        ...user.accounts.map((account) => account.accountIdentifier),
      ]
        .join(' ')
        .toLowerCase()
        .includes(term),
    )
  }, [data, search])

  return (
    <div className="p-6">
      <SettingsHeader
        title={t('users.title', 'Users')}
        subtitle={t('users.subtitle', 'Backend user accounts.')}
      >
        <Button onClick={() => setCreating(true)}>
          <i className="fas fa-plus" aria-hidden />
          {t('users.newUser', 'New user')}
        </Button>
      </SettingsHeader>

      {error && (
        <Placeholder
          icon="fa-triangle-exclamation"
          title={t('users.unavailable', 'Users are currently unavailable.')}
          className="py-10"
        />
      )}

      {isLoading && <UserTableSkeleton />}

      {data && (
        <>
          <SearchInput
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('users.search', 'Search users…')}
            wrapperClassName="mb-3 max-w-xs"
          />

          {users.length === 0 ? (
            <Placeholder
              icon="fa-users"
              title={
                search.trim() !== ''
                  ? t('users.noMatches', 'No users match your search.')
                  : t('users.none', 'No users found.')
              }
              className="py-10"
            />
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>{t('users.columnName', 'Name')}</TableHead>
                    <TableHead>{t('users.columnAccount', 'Account')}</TableHead>
                    <TableHead>{t('users.columnEmail', 'Email')}</TableHead>
                    <TableHead>{t('users.columnRoles', 'Roles')}</TableHead>
                    <TableHead>{t('users.columnStatus', 'Status')}</TableHead>
                    <TableHead>
                      <span className="sr-only">
                        {t('users.columnActions', 'Actions')}
                      </span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((user) => (
                    <UserRow
                      key={user.id}
                      user={user}
                      onEdit={() => setEditing(user)}
                      onResetPassword={() => setResetting(user)}
                      onDelete={() => setDeleting(user)}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}

      <CreateUserDialog open={creating} onOpenChange={setCreating} />
      <EditUserDialog
        user={editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
      />
      <ResetPasswordDialog
        user={resetting}
        onOpenChange={(open) => {
          if (!open) setResetting(null)
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        title={t('users.deleteTitle', 'Delete user "{0}"?', [
          deleting?.label ?? '',
        ])}
        description={t(
          'users.deleteDescription',
          'The user, their accounts and their personal workspaces including any unpublished changes are removed permanently.',
        )}
        confirmLabel={t('users.delete', 'Delete user')}
        onConfirm={async () => {
          const user = deleting!
          await deleteUser(user.id)
          queryClient.invalidateQueries({ queryKey: queryKeys.users })
          toast.success(
            t('users.deleted', 'The user "{0}" has been deleted.', [
              user.label,
            ]),
          )
        }}
      />
    </div>
  )
}

function UserRow({
  user,
  onEdit,
  onResetPassword,
  onDelete,
}: {
  user: User
  onEdit: () => void
  onResetPassword: () => void
  onDelete: () => void
}) {
  const activation = useMutation({
    mutationFn: (active: boolean) => updateUser(user.id, { active }),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users })
      toast.success(
        response.user.active
          ? t('users.activated', 'The user "{0}" has been activated.', [
              response.user.label,
            ])
          : t('users.deactivated', 'The user "{0}" has been deactivated.', [
              response.user.label,
            ]),
      )
    },
    onError: (error) =>
      toast.error(
        apiErrorDescription(
          error,
          t('users.activationFailedDetail', 'Changing the status failed.'),
        ),
        { title: t('users.activationFailed', 'Could not change status') },
      ),
  })

  return (
    <TableRow className="text-neutral-800 dark:text-neutral-200">
      <TableCell>
        <span className="font-medium text-neutral-950 dark:text-white">
          {user.fullName || user.label}
        </span>
        {user.isCurrentUser && (
          <Badge variant="outline" className="ml-2 align-middle">
            {t('users.you', 'You')}
          </Badge>
        )}
      </TableCell>
      <TableCell>
        {user.accounts.length === 0 ? (
          <span className="text-neutral-500">—</span>
        ) : (
          user.accounts.map((account) => (
            <div key={account.accountIdentifier} className="text-neutral-700 dark:text-neutral-300">
              {account.accountIdentifier}
            </div>
          ))
        )}
      </TableCell>
      <TableCell>{user.email ?? <span className="text-neutral-500">—</span>}</TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          {user.roles.length === 0 ? (
            <span className="text-neutral-500">—</span>
          ) : (
            user.roles.map((role) => (
              <Badge key={role} variant="secondary">
                {shortRole(role)}
              </Badge>
            ))
          )}
        </div>
      </TableCell>
      <TableCell>
        {user.active ? (
          <span className="inline-flex items-center gap-1.5 text-neutral-700 dark:text-neutral-300">
            <span className="size-1.5 rounded-full bg-green-500" />
            {t('users.active', 'Active')}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-neutral-500">
            <span className="size-1.5 rounded-full bg-neutral-400 dark:bg-neutral-600" />
            {t('users.inactive', 'Inactive')}
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
                aria-label={t('users.rowActions', 'User actions')}
              />
            }
          >
            <i className="fas fa-ellipsis-vertical" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onEdit}>
              <i className="fas fa-pen" aria-hidden />
              {t('users.edit', 'Edit')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onResetPassword}>
              <i className="fas fa-key" aria-hidden />
              {t('users.resetPassword', 'Reset password')}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={
                (user.active && user.isCurrentUser) || activation.isPending
              }
              onClick={() => activation.mutate(!user.active)}
            >
              <i
                className={`fas ${user.active ? 'fa-user-slash' : 'fa-user-check'}`}
                aria-hidden
              />
              {user.active
                ? t('users.deactivate', 'Deactivate')
                : t('users.activate', 'Activate')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              disabled={user.isCurrentUser}
              onClick={onDelete}
            >
              <i className="fas fa-trash" aria-hidden />
              {t('users.delete', 'Delete user')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  )
}

/** "Neos.Neos:Administrator" -> "Administrator"; leaves unprefixed roles as-is. */
function shortRole(role: string): string {
  const colon = role.lastIndexOf(':')
  return colon === -1 ? role : role.slice(colon + 1)
}

function UserTableSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  )
}
