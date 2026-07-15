/**
 * User administration, rendered as a section of the shared Settings modal (see
 * features/modals). This replaces the classic Neos Users backend module.
 *
 * Empty for now: it establishes the section so the settings registry has
 * something real to render. The user list and account editing fill in here.
 */
export function UserAdministration() {
  return (
    <div className="grid h-full place-items-center p-8 text-center text-neutral-400">
      <div>
        <p className="text-sm font-medium text-neutral-300">Users</p>
        <p className="mt-1 text-sm">User administration will live here.</p>
      </div>
    </div>
  )
}
