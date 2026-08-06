import { useEffect, useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'

import { apiErrorDescription } from '@/api/client'
import { updateUser, type User } from '@/api/users'
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

/**
 * Administrative password reset: sets a new password for the user without
 * requiring the old one (that self-service flow lives in the profile
 * settings). Also ends the user's active backend sessions server-side.
 */
export function ResetPasswordDialog({
  user,
  onOpenChange,
}: {
  /** The user whose password is reset; null renders the dialog closed. */
  user: User | null
  onOpenChange: (open: boolean) => void
}) {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  useEffect(() => {
    if (user !== null) {
      setPassword('')
      setConfirmPassword('')
    }
  }, [user])

  const mismatch = confirmPassword !== '' && password !== confirmPassword
  const canSubmit = password !== '' && password === confirmPassword

  const mutation = useMutation({
    mutationFn: () => updateUser(user!.id, { password }),
    onSuccess: (response) => {
      toast.success(
        t('users.passwordReset', 'The password of "{0}" has been reset.', [
          response.user.label,
        ]),
      )
      onOpenChange(false)
    },
    onError: (error) =>
      toast.error(
        apiErrorDescription(
          error,
          t('users.passwordResetFailedDetail', 'Resetting the password failed.'),
        ),
        { title: t('users.passwordResetFailed', 'Could not reset password') },
      ),
  })

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (canSubmit && !mutation.isPending) mutation.mutate()
  }

  return (
    <Dialog open={user !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('users.resetPassword', 'Reset password')}
            {user !== null && (
              <span className="ml-2 font-normal text-neutral-600 dark:text-neutral-400">
                {user.label}
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            {t(
              'users.resetPasswordHint',
              'Sets a new password without requiring the current one. Active sessions of this user are ended.',
            )}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <Field
            label={t('users.newPassword', 'New password')}
            htmlFor="user-reset-password"
          >
            <Input
              id="user-reset-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              required
            />
          </Field>
          <Field
            label={t('users.repeatNewPassword', 'Repeat new password')}
            htmlFor="user-reset-confirm-password"
          >
            <Input
              id="user-reset-confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              aria-invalid={mismatch || undefined}
              required
            />
          </Field>
          {mismatch && (
            <p className="text-sm text-red-500">
              {t('users.passwordMismatch', 'The passwords do not match.')}
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
                ? t('users.resetting', 'Resetting…')
                : t('users.resetPassword', 'Reset password')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
