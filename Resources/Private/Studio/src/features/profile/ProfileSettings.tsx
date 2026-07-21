import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useMutation } from '@tanstack/react-query'

import { apiErrorDescription } from '@/api/client'
import { queryKeys } from '@/api/keys'
import {
  changePassword,
  updateProfile,
  useProfile,
  type Profile,
  type UpdateProfileInput,
} from '@/api/profile'
import { queryClient } from '@/app/queryClient'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Placeholder } from '@/components/ui/placeholder'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toast'

/**
 * The own account, rendered as a section of the shared Settings modal (see
 * features/modals) and available to every logged-in user - the self-service
 * counterpart to the admin-only user administration. Backed by the /me/profile
 * and /me/password endpoints, which only ever touch the authenticated user.
 */
export function ProfileSettings() {
  const { data, isLoading, error } = useProfile()

  useEffect(() => {
    if (error) toast.error(error, { title: 'Could not load your profile' })
  }, [error])

  return (
    <div className="max-w-xl p-6">
      <header className="mb-4">
        <h2 className="text-base font-semibold text-white">Profile</h2>
        <p className="text-sm text-neutral-400">
          Your personal account settings.
        </p>
      </header>

      {error && (
        <Placeholder
          icon="fa-triangle-exclamation"
          title="Your profile is currently unavailable."
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

      {data && (
        <>
          <ProfileForm profile={data.profile} />
          <Separator className="my-8" />
          <PasswordForm />
        </>
      )}
    </div>
  )
}

/** Name, email and interface language; only changed fields are sent. */
function ProfileForm({ profile }: { profile: Profile }) {
  const [firstName, setFirstName] = useState(profile.firstName)
  const [lastName, setLastName] = useState(profile.lastName)
  const [email, setEmail] = useState(profile.email ?? '')
  const [language, setLanguage] = useState(profile.interfaceLanguage)

  const languageItems = Object.entries(profile.availableLanguages).map(
    ([value, label]) => ({ value, label }),
  )

  const changes: UpdateProfileInput = {}
  if (firstName !== profile.firstName) changes.firstName = firstName
  if (lastName !== profile.lastName) changes.lastName = lastName
  if (email !== (profile.email ?? '')) changes.email = email
  if (language !== profile.interfaceLanguage)
    changes.interfaceLanguage = language
  const isDirty = Object.keys(changes).length > 0

  const mutation = useMutation({
    mutationFn: (input: UpdateProfileInput) => updateProfile(input),
    onSuccess: (_response, input) => {
      // me covers profile (nested key); users so an admin's own row updates.
      queryClient.invalidateQueries({ queryKey: queryKeys.me })
      queryClient.invalidateQueries({ queryKey: queryKeys.users })
      toast.success('Your profile has been saved.')
      // Translations are loaded once at boot for the language the shell
      // injected, so a changed language only shows after a reload.
      if (input.interfaceLanguage !== undefined) {
        toast.info('The new interface language applies after the next reload.')
      }
    },
    onError: (error) =>
      toast.error(apiErrorDescription(error, 'Saving your profile failed.'), {
        title: 'Could not save profile',
      }),
  })

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (isDirty && !mutation.isPending) mutation.mutate(changes)
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Field label="First name" htmlFor="profile-first-name">
          <Input
            id="profile-first-name"
            value={firstName}
            onChange={(event) => setFirstName(event.target.value)}
            autoComplete="given-name"
            required
          />
        </Field>
        <Field label="Last name" htmlFor="profile-last-name">
          <Input
            id="profile-last-name"
            value={lastName}
            onChange={(event) => setLastName(event.target.value)}
            autoComplete="family-name"
            required
          />
        </Field>
      </div>

      <Field label="Email" htmlFor="profile-email">
        <Input
          id="profile-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
        />
      </Field>

      <Field label="Interface language" htmlFor="profile-language">
        <Select
          value={language}
          onValueChange={(value) => setLanguage(value as string)}
          // Lets SelectValue render the label for the selected value.
          items={languageItems}
        >
          <SelectTrigger id="profile-language" className="w-full">
            <SelectValue placeholder="Interface language" />
          </SelectTrigger>
          <SelectContent>
            {languageItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Button type="submit" disabled={!isDirty || mutation.isPending}>
        {mutation.isPending ? 'Saving…' : 'Save profile'}
      </Button>
    </form>
  )
}

/** Current + new password (repeated); the server verifies the current one. */
function PasswordForm() {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const mismatch = confirmPassword !== '' && newPassword !== confirmPassword
  const canSubmit =
    currentPassword !== '' &&
    newPassword !== '' &&
    newPassword === confirmPassword

  const mutation = useMutation({
    mutationFn: () => changePassword(currentPassword, newPassword),
    onSuccess: () => {
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      toast.success('Your password has been changed.')
    },
    onError: (error) =>
      toast.error(apiErrorDescription(error, 'Changing the password failed.'), {
        title: 'Could not change password',
      }),
  })

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (canSubmit && !mutation.isPending) mutation.mutate()
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <header>
        <h3 className="text-sm font-semibold text-white">Change password</h3>
        <p className="text-sm text-neutral-400">
          Enter your current password to set a new one.
        </p>
      </header>

      <Field label="Current password" htmlFor="profile-current-password">
        <Input
          id="profile-current-password"
          type="password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          autoComplete="current-password"
          required
        />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="New password" htmlFor="profile-new-password">
          <Input
            id="profile-new-password"
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            autoComplete="new-password"
            required
          />
        </Field>
        <Field label="Repeat new password" htmlFor="profile-confirm-password">
          <Input
            id="profile-confirm-password"
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
        <p className="text-sm text-red-500">The new passwords do not match.</p>
      )}

      <Button type="submit" disabled={!canSubmit || mutation.isPending}>
        {mutation.isPending ? 'Changing…' : 'Change password'}
      </Button>
    </form>
  )
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor: string
  children: ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={htmlFor}
        className="block text-sm font-medium text-neutral-200"
      >
        {label}
      </label>
      {children}
    </div>
  )
}
