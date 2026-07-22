import { useEffect, useState } from 'react'

import { apiErrorDescription } from '@/api/client'
import { queryKeys } from '@/api/keys'
import { useUsers } from '@/api/users'
import { deleteWorkspace, useWorkspaces, type Workspace } from '@/api/workspaces'
import { queryClient } from '@/app/queryClient'
import { useStudio } from '@/app/StudioContext'
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
import { CreateWorkspaceDialog } from './CreateWorkspaceDialog'
import { EditWorkspaceDialog } from './EditWorkspaceDialog'
import { WorkspaceRolesDialog } from './WorkspaceRolesDialog'

function classificationLabel(classification: string): string {
  switch (classification) {
    case 'ROOT':
      return t('workspacesAdmin.classificationRoot', 'Root')
    case 'PERSONAL':
      return t('workspacesAdmin.classificationPersonal', 'Personal')
    case 'SHARED':
      return t('workspacesAdmin.classificationShared', 'Shared')
    default:
      return classification
  }
}

/**
 * Workspace management, rendered as a section of the shared Settings modal
 * (see features/modals). Replaces the classic Workspaces module: create
 * shared/private workspaces, edit title/description, manage access (role
 * assignments) and delete.
 *
 * Available to every editor (me.permissions.workspaces, the classic module's
 * privilege); rows only offer actions where the account has the manage
 * permission - the server re-checks everything per workspace.
 */
export function WorkspacesAdministration() {
  const { data, isLoading, error } = useWorkspaces()
  const { data: usersData } = useUsers()
  const { workspaceName: activeWorkspaceName } = useStudio()

  const [creating, setCreating] = useState(false)
  // Tracked by name and resolved from live query data, so edits refresh.
  const [editingName, setEditingName] = useState<string | null>(null)
  const [rolesName, setRolesName] = useState<string | null>(null)
  const [deletingName, setDeletingName] = useState<string | null>(null)

  useEffect(() => {
    if (error)
      toast.error(error, {
        title: t('workspacesAdmin.loadFailed', 'Could not load workspaces'),
      })
  }, [error])

  const workspaces = data?.workspaces ?? []
  const editing = workspaces.find((w) => w.name === editingName) ?? null
  const roles = workspaces.find((w) => w.name === rolesName) ?? null
  const deleting = workspaces.find((w) => w.name === deletingName) ?? null

  // Owner user ids -> readable names, from the user roster every editor may read.
  const userLabels = new Map(
    (usersData?.users ?? []).map((user) => [user.id, user.fullName || user.label]),
  )

  return (
    <div className="p-6">
      <SettingsHeader
        title={t('workspacesAdmin.title', 'Workspaces')}
        subtitle={t(
          'workspacesAdmin.subtitle',
          'Where changes live until they are published.',
        )}
      >
        <Button onClick={() => setCreating(true)}>
          <i className="fas fa-plus" aria-hidden />
          {t('workspacesAdmin.newWorkspace', 'New workspace')}
        </Button>
      </SettingsHeader>

      {error && (
        <Placeholder
          icon="fa-triangle-exclamation"
          title={t(
            'workspacesAdmin.unavailable',
            'Workspaces are currently unavailable.',
          )}
          className="py-10"
        />
      )}

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      )}

      {data && workspaces.length > 0 && (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>{t('workspacesAdmin.columnTitle', 'Title')}</TableHead>
                <TableHead>{t('workspacesAdmin.columnBase', 'Base')}</TableHead>
                <TableHead>{t('workspacesAdmin.columnType', 'Type')}</TableHead>
                <TableHead>{t('workspacesAdmin.columnOwner', 'Owner')}</TableHead>
                <TableHead>
                  {t('workspacesAdmin.columnChanges', 'Changes')}
                </TableHead>
                <TableHead>
                  <span className="sr-only">
                    {t('workspacesAdmin.columnActions', 'Actions')}
                  </span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {workspaces.map((workspace) => (
                <WorkspaceRow
                  key={workspace.name}
                  workspace={workspace}
                  ownerLabel={
                    workspace.owner !== null
                      ? (userLabels.get(workspace.owner) ?? workspace.owner)
                      : null
                  }
                  isActive={workspace.name === activeWorkspaceName}
                  onEdit={() => setEditingName(workspace.name)}
                  onRoles={() => setRolesName(workspace.name)}
                  onDelete={() => setDeletingName(workspace.name)}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <CreateWorkspaceDialog
        open={creating}
        onOpenChange={setCreating}
        workspaces={workspaces}
      />
      <EditWorkspaceDialog
        workspace={editing}
        onOpenChange={(open) => {
          if (!open) setEditingName(null)
        }}
      />
      <WorkspaceRolesDialog
        workspace={roles}
        onOpenChange={(open) => {
          if (!open) setRolesName(null)
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingName(null)
        }}
        title={t('workspacesAdmin.deleteTitle', 'Delete workspace "{0}"?', [
          deleting?.title || (deleting?.name ?? ''),
        ])}
        description={
          deleting?.hasPublishableChanges
            ? t(
                'workspacesAdmin.deleteDescriptionChanges',
                'The workspace still has unpublished changes - they are discarded and lost permanently.',
              )
            : t(
                'workspacesAdmin.deleteDescription',
                'The workspace, its access assignments and its metadata are removed permanently.',
              )
        }
        confirmLabel={t('workspacesAdmin.delete', 'Delete workspace')}
        onConfirm={async () => {
          const workspace = deleting!
          try {
            await deleteWorkspace(workspace.name, true)
          } catch (deleteError) {
            // Surface the server's reason (e.g. dependent workspaces).
            throw new Error(
              apiErrorDescription(
                deleteError,
                t(
                  'workspacesAdmin.deleteFailedDetail',
                  'Deleting the workspace failed.',
                ),
              ),
            )
          }
          queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.all })
          toast.success(
            t('workspacesAdmin.deleted', 'The workspace "{0}" has been deleted.', [
              workspace.title || workspace.name,
            ]),
          )
        }}
      />
    </div>
  )
}

function WorkspaceRow({
  workspace,
  ownerLabel,
  isActive,
  onEdit,
  onRoles,
  onDelete,
}: {
  workspace: Workspace
  ownerLabel: string | null
  isActive: boolean
  onEdit: () => void
  onRoles: () => void
  onDelete: () => void
}) {
  const deletable =
    workspace.permissions.manage &&
    workspace.classification !== 'ROOT' &&
    workspace.classification !== 'PERSONAL' &&
    !isActive

  return (
    <TableRow className="text-neutral-200">
      <TableCell>
        <span className="font-medium text-white">
          {workspace.title || workspace.name}
        </span>
        <span className="ml-2 text-xs text-neutral-500">{workspace.name}</span>
        {isActive && (
          <Badge variant="outline" className="ml-2 align-middle">
            {t('workspacesAdmin.active', 'Active')}
          </Badge>
        )}
      </TableCell>
      <TableCell className="text-neutral-400">
        {workspace.baseWorkspace ?? (
          <span className="text-neutral-500">—</span>
        )}
      </TableCell>
      <TableCell>
        <Badge variant="secondary">
          {classificationLabel(workspace.classification)}
        </Badge>
      </TableCell>
      <TableCell className="text-neutral-400">
        {ownerLabel ?? <span className="text-neutral-500">—</span>}
      </TableCell>
      <TableCell>
        {workspace.hasPublishableChanges ? (
          <span className="inline-flex items-center gap-1.5 text-neutral-300">
            <span className="size-1.5 rounded-full bg-amber-500" />
            {t('workspacesAdmin.pending', 'Pending')}
          </span>
        ) : (
          <span className="text-neutral-500">
            {t('workspacesAdmin.none2', 'None')}
          </span>
        )}
      </TableCell>
      <TableCell className="w-10 text-right">
        {workspace.permissions.manage && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('workspacesAdmin.rowActions', 'Workspace actions')}
                />
              }
            >
              <i className="fas fa-ellipsis-vertical" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEdit}>
                <i className="fas fa-pen" aria-hidden />
                {t('workspacesAdmin.edit', 'Edit')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onRoles}>
                <i className="fas fa-user-lock" aria-hidden />
                {t('workspacesAdmin.manageAccess', 'Manage access')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                disabled={!deletable}
                onClick={onDelete}
              >
                <i className="fas fa-trash" aria-hidden />
                {t('workspacesAdmin.delete', 'Delete workspace')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </TableCell>
    </TableRow>
  )
}
