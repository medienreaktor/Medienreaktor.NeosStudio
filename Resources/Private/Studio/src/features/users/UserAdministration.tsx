import type { ReactNode } from 'react'
import { useUsers, type User } from '@/api/users'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * User administration, rendered as a section of the shared Settings modal (see
 * features/modals). This replaces the classic Neos Users backend module.
 *
 * For now it lists the backend users read-only. The section is administrators
 * only - the host disables its subnav entry for non-admins and only mounts
 * this component when the user has the "users" permission, so the /users
 * request here always comes from an admin (the endpoint 403s otherwise).
 * Account editing (create, roles, activate, password) fills in from here.
 */
export function UserAdministration() {
  const { data, isLoading, error } = useUsers()

  return (
    <div className="p-6">
      <header className="mb-4">
        <h2 className="text-base font-semibold text-white">Users</h2>
        <p className="text-sm text-neutral-400">Backend user accounts.</p>
      </header>

      {error && (
        <p className="text-sm text-red-500">
          Could not load users. {error instanceof Error ? error.message : ''}
        </p>
      )}

      {isLoading && <UserTableSkeleton />}

      {data && data.users.length === 0 && (
        <p className="text-sm text-neutral-400">No users found.</p>
      )}

      {data && data.users.length > 0 && (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-left text-sm">
            <thead className="border-b text-xs text-neutral-400">
              <tr>
                <Th>Name</Th>
                <Th>Email</Th>
                <Th>Roles</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {data.users.map((user) => (
                <UserRow key={user.id} user={user} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function UserRow({ user }: { user: User }) {
  return (
    <tr className="text-neutral-200">
      <Td>
        <span className="font-medium text-white">
          {user.fullName || user.label}
        </span>
        {user.isCurrentUser && (
          <Badge variant="outline" className="ml-2 align-middle">
            You
          </Badge>
        )}
      </Td>
      <Td>{user.email ?? <span className="text-neutral-500">—</span>}</Td>
      <Td>
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
      </Td>
      <Td>
        {user.active ? (
          <span className="inline-flex items-center gap-1.5 text-neutral-300">
            <span className="size-1.5 rounded-full bg-green-500" />
            Active
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-neutral-500">
            <span className="size-1.5 rounded-full bg-neutral-600" />
            Inactive
          </span>
        )}
      </Td>
    </tr>
  )
}

/** "Neos.Neos:Administrator" -> "Administrator"; leaves unprefixed roles as-is. */
function shortRole(role: string): string {
  const colon = role.lastIndexOf(':')
  return colon === -1 ? role : role.slice(colon + 1)
}

function Th({ children }: { children: ReactNode }) {
  return <th className="px-3 py-2 font-medium">{children}</th>
}

function Td({ children }: { children: ReactNode }) {
  return <td className="px-3 py-2.5 align-middle">{children}</td>
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
