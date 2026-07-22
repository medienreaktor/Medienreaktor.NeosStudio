import { useUserRoles } from '@/api/users'
import { Checkbox } from '@/components/ui/checkbox'
import { Field } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { translate as t } from '@/lib/i18n'

/**
 * The role picker of the user dialogs: one checkbox per assignable role from
 * /users/roles (admin-gated, like everything around it). Roles listed in
 * lockedRoles render disabled - used to pin the own Administrator role, which
 * the server refuses to drop anyway (self-lockout guard).
 */
export function RolesField({
  value,
  onChange,
  lockedRoles = [],
}: {
  value: string[]
  onChange: (roles: string[]) => void
  lockedRoles?: string[]
}) {
  const { data, isLoading } = useUserRoles()

  const toggle = (identifier: string, checked: boolean) => {
    onChange(
      checked
        ? [...value, identifier]
        : value.filter((role) => role !== identifier),
    )
  }

  return (
    <Field label={t('users.roles', 'Roles')}>
      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-5 w-48" />
          ))}
        </div>
      )}
      {data && (
        <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-3">
          {data.roles.map((role) => {
            const locked = lockedRoles.includes(role.identifier)
            return (
              <label
                key={role.identifier}
                className="flex cursor-pointer items-center gap-2.5 py-0.5 text-sm text-neutral-200 has-[[disabled]]:cursor-not-allowed"
              >
                <Checkbox
                  checked={value.includes(role.identifier)}
                  onCheckedChange={(checked) =>
                    toggle(role.identifier, checked === true)
                  }
                  disabled={locked}
                />
                <span className="min-w-0">
                  {role.label}
                  <span className="ml-2 text-xs text-neutral-500">
                    {role.identifier}
                  </span>
                </span>
              </label>
            )
          })}
        </div>
      )}
    </Field>
  )
}
