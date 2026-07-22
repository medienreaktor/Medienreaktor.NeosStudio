import { useEffect, useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'

import { apiErrorDescription } from '@/api/client'
import { queryKeys } from '@/api/keys'
import { createUser } from '@/api/users'
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

const DEFAULT_ROLES = ['Neos.Neos:Editor']

/**
 * Create a backend user with one account on the default authentication
 * provider - username, password, name, optional email and the assigned roles
 * (Editor preselected, like the classic module).
 */
export function CreateUserDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [username, setUsername] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [roles, setRoles] = useState<string[]>(DEFAULT_ROLES)

  // A fresh form every time the dialog opens.
  useEffect(() => {
    if (open) {
      setUsername('')
      setFirstName('')
      setLastName('')
      setEmail('')
      setPassword('')
      setConfirmPassword('')
      setRoles(DEFAULT_ROLES)
    }
  }, [open])

  const mismatch = confirmPassword !== '' && password !== confirmPassword
  const canSubmit =
    username.trim() !== '' &&
    firstName.trim() !== '' &&
    lastName.trim() !== '' &&
    password !== '' &&
    password === confirmPassword

  const mutation = useMutation({
    mutationFn: () =>
      createUser({
        username: username.trim(),
        password,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        roles,
        ...(email.trim() !== '' ? { email: email.trim() } : {}),
      }),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users })
      toast.success(
        t('users.created', 'The user "{0}" has been created.', [
          response.user.label,
        ]),
      )
      onOpenChange(false)
    },
    onError: (error) =>
      toast.error(
        apiErrorDescription(
          error,
          t('users.createFailedDetail', 'Creating the user failed.'),
        ),
        { title: t('users.createFailed', 'Could not create user') },
      ),
  })

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (canSubmit && !mutation.isPending) mutation.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{t('users.newUser', 'New user')}</DialogTitle>
          <DialogDescription>
            {t(
              'users.newUserHint',
              'Creates a backend account on the default authentication provider.',
            )}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <Field label={t('users.username', 'Username')} htmlFor="user-create-username">
            <Input
              id="user-create-username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="off"
              required
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field
              label={t('users.firstName', 'First name')}
              htmlFor="user-create-first-name"
            >
              <Input
                id="user-create-first-name"
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                autoComplete="off"
                required
              />
            </Field>
            <Field
              label={t('users.lastName', 'Last name')}
              htmlFor="user-create-last-name"
            >
              <Input
                id="user-create-last-name"
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
                autoComplete="off"
                required
              />
            </Field>
          </div>

          <Field label={t('users.email', 'Email')} htmlFor="user-create-email">
            <Input
              id="user-create-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="off"
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field
              label={t('users.password', 'Password')}
              htmlFor="user-create-password"
            >
              <Input
                id="user-create-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                required
              />
            </Field>
            <Field
              label={t('users.repeatPassword', 'Repeat password')}
              htmlFor="user-create-confirm-password"
            >
              <Input
                id="user-create-confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
                aria-invalid={mismatch || undefined}
                required
              />
            </Field>
          </div>
          {mismatch && (
            <p className="text-sm text-red-500">
              {t('users.passwordMismatch', 'The passwords do not match.')}
            </p>
          )}

          <RolesField value={roles} onChange={setRoles} />

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
                ? t('users.creating', 'Creating…')
                : t('users.create', 'Create user')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
