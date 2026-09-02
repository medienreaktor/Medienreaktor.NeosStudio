import { useEffect, useState, type FormEvent } from 'react'
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
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { translate as t } from '@/lib/i18n'
import {
  applyUiMode,
  toUiMode,
  UI_MODE_PREFERENCE,
  type UiMode,
} from '@/lib/uiMode'
import { UiModePicker } from '@/features/profile/UiModePicker'
import { SettingsHeader } from '@/features/modals/SettingsHeader'
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
    if (error)
      toast.error(error, {
        title: t('profile.loadFailed', 'Could not load your profile'),
      })
  }, [error])

  return (
    <div className="max-w-xl p-6 pt-3">
      <SettingsHeader
        title={t('profile.title', 'Profile')}
        subtitle={t('profile.subtitle', 'Your personal account settings.')}
      />

      {error && (
        <Placeholder
          icon="fa-triangle-exclamation"
          title={t(
            'profile.unavailable',
            'Your profile is currently unavailable.',
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

/** Name, email, interface language and UI mode; only changed fields are sent. */
function ProfileForm({ profile }: { profile: Profile }) {
  const [firstName, setFirstName] = useState(profile.firstName)
  const [lastName, setLastName] = useState(profile.lastName)
  const [email, setEmail] = useState(profile.email ?? '')
  const [language, setLanguage] = useState(profile.interfaceLanguage)
  const savedUiMode = toUiMode(profile.preferences?.[UI_MODE_PREFERENCE])
  const [uiMode, setUiMode] = useState<UiMode>(savedUiMode)

  // Neos ships language labels as "Deutsch – German"; show the native name
  // prominently with the English name muted behind it.
  const languageItems = Object.entries(profile.availableLanguages).map(
    ([value, label]) => {
      const [native, english] = label.split(' – ')
      return {
        value,
        label: (
          <span>
            {native}
            {english && (
              <span className="ml-2 text-neutral-600 dark:text-neutral-400">
                {english}
              </span>
            )}
          </span>
        ),
      }
    },
  )

  const changes: UpdateProfileInput = {}
  if (firstName !== profile.firstName) changes.firstName = firstName
  if (lastName !== profile.lastName) changes.lastName = lastName
  if (email !== (profile.email ?? '')) changes.email = email
  if (language !== profile.interfaceLanguage)
    changes.interfaceLanguage = language
  if (uiMode !== savedUiMode)
    changes.preferences = { [UI_MODE_PREFERENCE]: uiMode }
  const isDirty = Object.keys(changes).length > 0

  const mutation = useMutation({
    mutationFn: (input: UpdateProfileInput) => updateProfile(input),
    onSuccess: (_response, input) => {
      // me covers profile (nested key); users so an admin's own row updates.
      queryClient.invalidateQueries({ queryKey: queryKeys.me })
      queryClient.invalidateQueries({ queryKey: queryKeys.users })
      toast.success(t('profile.saved', 'Your profile has been saved.'))
      // The theme switches live - no reload needed for the UI mode.
      if (input.preferences?.[UI_MODE_PREFERENCE] !== undefined) {
        applyUiMode(toUiMode(input.preferences[UI_MODE_PREFERENCE]))
      }
      // Translations are loaded once at boot for the language the shell
      // injected, so a changed language only shows after a reload.
      if (input.interfaceLanguage !== undefined) {
        toast.info(
          t(
            'profile.languageReload',
            'The new interface language applies after the next reload.',
          ),
        )
      }
    },
    onError: (error) =>
      toast.error(
        apiErrorDescription(
          error,
          t('profile.saveFailedDetail', 'Saving your profile failed.'),
        ),
        {
          title: t('profile.saveFailed', 'Could not save profile'),
        },
      ),
  })

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (isDirty && !mutation.isPending) mutation.mutate(changes)
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Field
          label={t('profile.firstName', 'First name')}
          htmlFor="profile-first-name"
        >
          <Input
            id="profile-first-name"
            value={firstName}
            onChange={(event) => setFirstName(event.target.value)}
            autoComplete="given-name"
            required
          />
        </Field>
        <Field
          label={t('profile.lastName', 'Last name')}
          htmlFor="profile-last-name"
        >
          <Input
            id="profile-last-name"
            value={lastName}
            onChange={(event) => setLastName(event.target.value)}
            autoComplete="family-name"
            required
          />
        </Field>
      </div>

      <Field label={t('profile.email', 'Email')} htmlFor="profile-email">
        <Input
          id="profile-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
        />
      </Field>

      <Field
        label={t('profile.interfaceLanguage', 'Interface language')}
        htmlFor="profile-language"
      >
        <Select
          value={language}
          onValueChange={(value) => setLanguage(value as string)}
          // Lets SelectValue render the label for the selected value.
          items={languageItems}
        >
          <SelectTrigger id="profile-language" className="w-full">
            <SelectValue
              placeholder={t('profile.interfaceLanguage', 'Interface language')}
            />
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

      <Field label={t('profile.uiMode', 'Appearance')}>
        <UiModePicker value={uiMode} onChange={setUiMode} />
      </Field>

      <Button type="submit" disabled={!isDirty || mutation.isPending}>
        {mutation.isPending
          ? t('profile.saving', 'Saving…')
          : t('profile.saveProfile', 'Save profile')}
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
      toast.success(
        t('profile.passwordChanged', 'Your password has been changed.'),
      )
    },
    onError: (error) =>
      toast.error(
        apiErrorDescription(
          error,
          t('profile.passwordFailedDetail', 'Changing the password failed.'),
        ),
        {
          title: t('profile.passwordFailed', 'Could not change password'),
        },
      ),
  })

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (canSubmit && !mutation.isPending) mutation.mutate()
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <header>
        <h3 className="text-sm font-semibold text-neutral-950 dark:text-white">
          {t('profile.changePassword', 'Change password')}
        </h3>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          {t(
            'profile.changePasswordHint',
            'Enter your current password to set a new one.',
          )}
        </p>
      </header>

      <Field
        label={t('profile.currentPassword', 'Current password')}
        htmlFor="profile-current-password"
      >
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
        <Field
          label={t('profile.newPassword', 'New password')}
          htmlFor="profile-new-password"
        >
          <Input
            id="profile-new-password"
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            autoComplete="new-password"
            required
          />
        </Field>
        <Field
          label={t('profile.repeatNewPassword', 'Repeat new password')}
          htmlFor="profile-confirm-password"
        >
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
        <p className="text-sm text-red-500">
          {t('profile.passwordMismatch', 'The new passwords do not match.')}
        </p>
      )}

      <Button type="submit" disabled={!canSubmit || mutation.isPending}>
        {mutation.isPending
          ? t('profile.changing', 'Changing…')
          : t('profile.changePassword', 'Change password')}
      </Button>
    </form>
  )
}
