import { useEffect, useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'

import { apiErrorDescription } from '@/api/client'
import { queryKeys } from '@/api/keys'
import { useMe } from '@/api/me'
import { useUserRoles, useUsers } from '@/api/users'
import {
  assignWorkspaceRole,
  unassignWorkspaceRole,
  useWorkspaceRoles,
  type Workspace,
  type WorkspaceRoleAssignment,
} from '@/api/workspaces'
import { queryClient } from '@/app/queryClient'
import { Badge } from '@/components/ui/badge'
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
import { Placeholder } from '@/components/ui/placeholder'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toast'
import { translate as t } from '@/lib/i18n'

const WORKSPACE_ROLES = ['VIEWER', 'COLLABORATOR', 'MANAGER'] as const

function roleLabel(role: string): string {
  switch (role) {
    case 'VIEWER':
      return t('workspacesAdmin.roleViewer', 'Viewer')
    case 'COLLABORATOR':
      return t('workspacesAdmin.roleCollaborator', 'Collaborator')
    case 'MANAGER':
      return t('workspacesAdmin.roleManager', 'Manager')
    default:
      return role
  }
}

/**
 * Manage who may access a workspace: the role assignments (user or group ->
 * viewer/collaborator/manager). Only offered for workspaces the account
 * manages; the server re-checks. Users are picked from the user listing
 * (readable by every editor); groups from the role catalog when the account
 * is an administrator, otherwise via a free-text role identifier.
 */
export function WorkspaceRolesDialog({
  workspace,
  onOpenChange,
}: {
  /** The workspace whose access is managed; null renders the dialog closed. */
  workspace: Workspace | null
  onOpenChange: (open: boolean) => void
}) {
  const workspaceName = workspace?.name ?? null
  const { data, isLoading, error } = useWorkspaceRoles(workspaceName)

  useEffect(() => {
    if (error)
      toast.error(error, {
        title: t('workspacesAdmin.rolesLoadFailed', 'Could not load access'),
      })
  }, [error])

  const remove = useMutation({
    mutationFn: (assignment: WorkspaceRoleAssignment) =>
      unassignWorkspaceRole(workspaceName!, assignment),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.all }),
    onError: (mutationError) =>
      toast.error(
        apiErrorDescription(
          mutationError,
          t(
            'workspacesAdmin.roleRemoveFailedDetail',
            'Removing the access failed.',
          ),
        ),
        { title: t('workspacesAdmin.roleRemoveFailed', 'Could not remove access') },
      ),
  })

  return (
    <Dialog open={workspace !== null} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>
            {t('workspacesAdmin.manageAccess', 'Manage access')}
            {workspace !== null && (
              <span className="ml-2 font-normal text-neutral-400">
                {workspace.title || workspace.name}
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            {t(
              'workspacesAdmin.manageAccessHint',
              'Who may view, edit or manage this workspace. Owners and administrators always have full access.',
            )}
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        )}

        {data && (
          <>
            {data.assignments.length === 0 ? (
              <Placeholder
                icon="fa-user-lock"
                title={t(
                  'workspacesAdmin.noAssignments',
                  'No access assigned yet.',
                )}
                className="py-6"
              />
            ) : (
              <ul className="space-y-1">
                {data.assignments.map((assignment) => (
                  <li
                    key={`${assignment.subjectType}:${assignment.subject}`}
                    className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-sm"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <i
                        className={`fas ${assignment.subjectType === 'USER' ? 'fa-user' : 'fa-users'} text-xs text-neutral-500`}
                        aria-hidden
                      />
                      <span className="truncate text-neutral-200">
                        {assignment.label}
                      </span>
                      <Badge variant="secondary">
                        {roleLabel(assignment.role)}
                      </Badge>
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t('workspacesAdmin.removeAccess', 'Remove access')}
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(assignment)}
                    >
                      <i className="fas fa-xmark" aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            {workspaceName !== null && (
              <AddAssignmentForm
                workspaceName={workspaceName}
                existing={data.assignments}
              />
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function AddAssignmentForm({
  workspaceName,
  existing,
}: {
  workspaceName: string
  existing: WorkspaceRoleAssignment[]
}) {
  const [subjectType, setSubjectType] = useState<'USER' | 'GROUP'>('USER')
  const [subject, setSubject] = useState('')
  const [role, setRole] = useState<(typeof WORKSPACE_ROLES)[number]>('COLLABORATOR')

  const isAdmin = useMe().data?.permissions.users ?? false
  const { data: usersData } = useUsers()
  // The role catalog is admin-only; non-admin managers type the identifier.
  const { data: rolesData } = useUserRoles(isAdmin)

  const assignedSubjects = new Set(
    existing.map((a) => `${a.subjectType}:${a.subject}`),
  )
  const userItems = (usersData?.users ?? [])
    .filter((user) => !assignedSubjects.has(`USER:${user.id}`))
    .map((user) => ({ value: user.id, label: user.fullName || user.label }))
  const groupItems = (rolesData?.roles ?? [])
    .filter((group) => !assignedSubjects.has(`GROUP:${group.identifier}`))
    .map((group) => ({ value: group.identifier, label: group.label }))
  const subjectTypeItems = [
    { value: 'USER', label: t('workspacesAdmin.subjectUser', 'User') },
    { value: 'GROUP', label: t('workspacesAdmin.subjectGroup', 'Group (role)') },
  ]
  const roleItems = WORKSPACE_ROLES.map((value) => ({
    value,
    label: roleLabel(value),
  }))

  const mutation = useMutation({
    mutationFn: () =>
      assignWorkspaceRole(workspaceName, { subjectType, subject, role }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.all })
      setSubject('')
    },
    onError: (error) =>
      toast.error(
        apiErrorDescription(
          error,
          t('workspacesAdmin.roleAssignFailedDetail', 'Assigning the access failed.'),
        ),
        { title: t('workspacesAdmin.roleAssignFailed', 'Could not assign access') },
      ),
  })

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (subject !== '' && !mutation.isPending) mutation.mutate()
  }

  const subjectItems = subjectType === 'USER' ? userItems : groupItems
  const useSubjectSelect = subjectType === 'USER' || isAdmin

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-3 rounded-md border border-dashed p-3"
    >
      <div className="grid grid-cols-[8rem_1fr_10rem] gap-2">
        <Field
          label={t('workspacesAdmin.subjectType', 'Type')}
          htmlFor="workspace-role-subject-type"
        >
          <Select
            value={subjectType}
            onValueChange={(value) => {
              setSubjectType(value as 'USER' | 'GROUP')
              setSubject('')
            }}
            items={subjectTypeItems}
          >
            <SelectTrigger id="workspace-role-subject-type" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {subjectTypeItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field
          label={
            subjectType === 'USER'
              ? t('workspacesAdmin.subjectUser', 'User')
              : t('workspacesAdmin.subjectGroup', 'Group (role)')
          }
          htmlFor="workspace-role-subject"
        >
          {useSubjectSelect ? (
            <Select
              value={subject === '' ? null : subject}
              onValueChange={(value) => setSubject(value as string)}
              items={subjectItems}
            >
              <SelectTrigger id="workspace-role-subject" className="w-full">
                <SelectValue
                  placeholder={t('workspacesAdmin.selectSubject', 'Select…')}
                />
              </SelectTrigger>
              <SelectContent>
                {subjectItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              id="workspace-role-subject"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="Neos.Neos:AbstractEditor"
              autoComplete="off"
            />
          )}
        </Field>

        <Field
          label={t('workspacesAdmin.role', 'Role')}
          htmlFor="workspace-role-role"
        >
          <Select
            value={role}
            onValueChange={(value) =>
              setRole(value as (typeof WORKSPACE_ROLES)[number])
            }
            items={roleItems}
          >
            <SelectTrigger id="workspace-role-role" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {roleItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <div className="flex justify-end">
        <Button
          type="submit"
          size="xs"
          disabled={subject === '' || mutation.isPending}
        >
          {mutation.isPending
            ? t('workspacesAdmin.assigning', 'Assigning…')
            : t('workspacesAdmin.assign', 'Grant access')}
        </Button>
      </div>
    </form>
  )
}
