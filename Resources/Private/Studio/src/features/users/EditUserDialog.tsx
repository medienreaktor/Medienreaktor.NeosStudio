import { useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'

import { apiErrorDescription } from '@/api/http/errors'
import { neosKeys } from '@/api/neos/keys'
import { updateUser, userRoles } from '@/api/neos/endpoints/users'
import type { User, UserUpdate } from '@/api/neos/schema'
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
import { useIsCurrentUser } from './user'

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
  // The last user shown, so the popup keeps its content while it fades out
  // after `user` went back to null.
  const [shown, setShown] = useState(user)
  if (user !== null && user !== shown) setShown(user)

  return (
    <Dialog open={user !== null} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        {/* Mounted per opening (the popup unmounts while closed) and keyed
            by user: seeded once from the user, so a refetch of the user list
            while the form is open does not wipe the edits. */}
        {shown !== null && (
          <EditUserForm
            key={shown.id}
            user={shown}
            onOpenChange={onOpenChange}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function EditUserForm({
  user,
  onOpenChange,
}: {
  user: User
  onOpenChange: (open: boolean) => void
}) {
  const [firstName, setFirstName] = useState(() => user.firstName ?? '')
  const [lastName, setLastName] = useState(() => user.lastName ?? '')
  const [email, setEmail] = useState(() => user.email ?? '')
  const [roles, setRoles] = useState<string[]>(() => userRoles(user))
  const isCurrentUser = useIsCurrentUser()(user)

  const changes: UserUpdate = {}
  const trimmedFirstName = firstName.trim()
  const trimmedLastName = lastName.trim()
  const trimmedEmail = email.trim()
  if (trimmedFirstName !== (user.firstName ?? ''))
    changes.firstName = trimmedFirstName
  if (trimmedLastName !== (user.lastName ?? ''))
    changes.lastName = trimmedLastName
  // An address can be changed but not removed - a cleared field is no change.
  if (trimmedEmail !== '' && trimmedEmail !== (user.email ?? ''))
    changes.email = trimmedEmail
  const currentRoles = userRoles(user)
  const rolesChanged =
    roles.length !== currentRoles.length ||
    roles.some((role) => !currentRoles.includes(role))
  if (rolesChanged) changes.roles = roles
  const isDirty = Object.keys(changes).length > 0
  const canSubmit = isDirty && trimmedFirstName !== '' && trimmedLastName !== ''

  const mutation = useMutation({
    mutationFn: (input: UserUpdate) => updateUser(user.id, input),
    onSuccess: (response) => {
      void queryClient.invalidateQueries({ queryKey: neosKeys.users.all })
      // Editing yourself can change your own label and roles.
      if (isCurrentUser) {
        void queryClient.invalidateQueries({ queryKey: neosKeys.me })
      }
      toast.success(
        t('users.saved', 'The user "{0}" has been saved.', [response.label]),
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
    <>
      <DialogHeader>
        <DialogTitle>
          {t('users.editUser', 'Edit user')}
          <span className="ml-2 font-normal text-neutral-600 dark:text-neutral-400">
            {user.label}
          </span>
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
          lockedRoles={isCurrentUser ? [ADMINISTRATOR_ROLE] : []}
        />
        {isCurrentUser && (
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
    </>
  )
}
