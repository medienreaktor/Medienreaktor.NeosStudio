import { useEffect, useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'

import { apiErrorDescription } from '@/api/client'
import { queryKeys } from '@/api/keys'
import { updateUser, type UpdateUserInput, type User } from '@/api/users'
import { queryClient } from '@/app/queryClient'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/toast'
import { translate as t } from '@/lib/i18n'
import { Field } from '@/components/ui/field'
import { RolesField } from './UserFormFields'

const ADMINISTRATOR_ROLE = 'Neos.Neos:Administrator'

/**
 * Edit a user's details: name, email and assigned roles. Only changed fields
 * are sent (PATCH semantics). The own Administrator role is pinned - the
 * server refuses to drop it anyway (self-lockout guard), so the checkbox is
 * disabled up front. Password resets and activation live in the row menu, not
 * here, to keep the form an ordinary "details" edit.
 */
export function EditUserDialog({
  user,
  onOpenChange,
}: {
  /** The user being edited; null renders the dialog closed. */
  user: User | null
  onOpenChange: (open: boolean) => void
}) {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [roles, setRoles] = useState<string[]>([])

  // Re-seed the form whenever a (new) user is opened for editing.
  useEffect(() => {
    if (user !== null) {
      setFirstName(user.firstName ?? '')
      setLastName(user.lastName ?? '')
      setEmail(user.email ?? '')
      setRoles(user.roles)
    }
  }, [user])

  const changes: UpdateUserInput = {}
  if (user !== null) {
    if (firstName !== (user.firstName ?? '')) changes.firstName = firstName
    if (lastName !== (user.lastName ?? '')) changes.lastName = lastName
    if (email !== (user.email ?? '')) changes.email = email
    const rolesChanged =
      roles.length !== user.roles.length ||
      roles.some((role) => !user.roles.includes(role))
    if (rolesChanged) changes.roles = roles
  }
  const isDirty = Object.keys(changes).length > 0
  const canSubmit =
    isDirty && firstName.trim() !== '' && lastName.trim() !== ''

  const mutation = useMutation({
    mutationFn: (input: UpdateUserInput) => updateUser(user!.id, input),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users })
      // Editing yourself can change your own label and roles.
      if (user?.isCurrentUser) {
        queryClient.invalidateQueries({ queryKey: queryKeys.me })
      }
      toast.success(
        t('users.saved', 'The user "{0}" has been saved.', [
          response.user.label,
        ]),
      )
      onOpenChange(false)
    },
    onError: (error) =>
      toast.error(
        apiErrorDescription(
          error,
          t('users.saveFailedDetail', 'Saving the user failed.'),
        ),
        { title: t('users.saveFailed', 'Could not save user') },
      ),
  })

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (canSubmit && !mutation.isPending) mutation.mutate(changes)
  }

  return (
    <Dialog open={user !== null} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>
            {t('users.editUser', 'Edit user')}
            {user !== null && (
              <span className="ml-2 font-normal text-neutral-400">
                {user.label}
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            {t('users.editUserHint', 'Name, email address and roles.')}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field
              label={t('users.firstName', 'First name')}
              htmlFor="user-edit-first-name"
            >
              <Input
                id="user-edit-first-name"
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                autoComplete="off"
                required
              />
            </Field>
            <Field
              label={t('users.lastName', 'Last name')}
              htmlFor="user-edit-last-name"
            >
              <Input
                id="user-edit-last-name"
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
                autoComplete="off"
                required
              />
            </Field>
          </div>

          <Field label={t('users.email', 'Email')} htmlFor="user-edit-email">
            <Input
              id="user-edit-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="off"
            />
          </Field>

          <RolesField
            value={roles}
            onChange={setRoles}
            lockedRoles={user?.isCurrentUser ? [ADMINISTRATOR_ROLE] : []}
          />
          {user?.isCurrentUser && (
            <p className="text-xs text-neutral-500">
              {t(
                'users.ownAdminLocked',
                'You cannot remove your own Administrator role.',
              )}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={mutation.isPending}
            >
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button type="submit" disabled={!canSubmit || mutation.isPending}>
              {mutation.isPending
                ? t('users.saving', 'Saving…')
                : t('users.save', 'Save user')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
