import type { ReactNode } from 'react'

/**
 * The uniform header of a settings-dialog section: title, subtitle and an
 * optional action slot on the right (e.g. the "New user" button). Every
 * settings screen (profile, users, and the sites/workspaces screens to come)
 * starts with this so the sections read as one surface.
 */
export function SettingsHeader({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children?: ReactNode
}) {
  return (
    <header className="mb-4 flex items-start justify-between gap-4">
      <div>
        <h2 className="text-base font-semibold text-neutral-950 dark:text-white">{title}</h2>
        {subtitle && <p className="text-sm text-neutral-600 dark:text-neutral-400">{subtitle}</p>}
      </div>
      {children}
    </header>
  )
}
