import { config } from '@/config'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { translate as t } from '@/lib/i18n'

/**
 * The legacy-modules menu next to the logo: the classic Neos backend modules
 * (what the old UI's hamburger menu shows), privilege-filtered and
 * label-translated server-side by the StudioController. Shown by default;
 * Medienreaktor.NeosStudio.enableLegacyModules: false hides it.
 *
 * A module with submodules renders as a labelled group of its submodules (the
 * module's own index page is just a card list of them); one without renders
 * as a single item. Selecting an entry leaves the Studio for the classic
 * backend - same-window, like the old UI's menu - and the "Neos Studio"
 * backend module leads back here.
 */
export function LegacyModulesMenu() {
  const modules = config.legacyModules
  if (modules.length === 0) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t('app.legacyModules', 'Backend modules')}
        title={t('app.legacyModules', 'Backend modules')}
        className="flex size-9 text-xl mt-1.5 -ml-2 mr-2 shrink-0 cursor-pointer items-center justify-center rounded-md text-neutral-950 select-none hover:bg-transparent hover:text-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-hidden dark:text-white dark:hover:bg-transparent"
      >
        <i className="fas fa-bars" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        {modules.map((module, index) => (
          <DropdownMenuGroup key={module.uri}>
            {index > 0 && <DropdownMenuSeparator />}
            {module.submodules.length === 0 ? (
              <DropdownMenuItem
                onClick={() => window.location.assign(module.uri)}
              >
                <i
                  className={`${module.icon || 'fas fa-puzzle-piece'} w-4 text-center`}
                  aria-hidden
                />
                {module.label}
              </DropdownMenuItem>
            ) : (
              <>
                <DropdownMenuLabel>{module.label}</DropdownMenuLabel>
                {module.submodules.map((submodule) => (
                  <DropdownMenuItem
                    key={submodule.uri}
                    onClick={() => window.location.assign(submodule.uri)}
                  >
                    <i
                      className={`${submodule.icon || 'fas fa-puzzle-piece'} w-4 text-center`}
                      aria-hidden
                    />
                    {submodule.label}
                  </DropdownMenuItem>
                ))}
              </>
            )}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
