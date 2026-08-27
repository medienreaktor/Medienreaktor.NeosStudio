import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useMutation } from '@tanstack/react-query'

import {
  createAccessRole,
  unrestrictedConstraints,
  updateAccessRole,
  useAccessRoles,
  type AccessCapability,
  type AccessRole,
  type AccessRoleConstraints,
  type NodeTreeRule,
} from '@/api/accessRoles'
import { apiErrorDescription } from '@/api/client'
import { useDimensions } from '@/api/dimensions'
import { queryKeys } from '@/api/keys'
import { useSites } from '@/api/sites'
import { useUsers } from '@/api/users'
import { useWorkspaces } from '@/api/workspaces'
import { queryClient } from '@/app/queryClient'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Placeholder } from '@/components/ui/placeholder'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/components/ui/toast'
import { translate as t } from '@/lib/i18n'
import { NodeTreeRuleEditor } from './NodeTreeRuleEditor'

/**
 * Create and edit one access role. Seven tabs along the axes a role can
 * narrow - sites, page tree, dimensions, workspaces, what may be done, and
 * who it applies to.
 *
 * Everything is edited as one draft and saved in one request. Restrictions
 * interact (excluding a site changes which branches are even reachable), so
 * a per-field autosave would let an administrator watch a role pass through
 * states they never intended to exist - the more so while the roles are
 * enforced live against people currently editing.
 *
 * The dialog is deliberately permissive-by-default at every turn: a fresh
 * role restricts nothing, and each tab says so in the same words - "all X" is
 * the state where nothing is ticked.
 */
export function AccessRoleDialog({
  open,
  role,
  onOpenChange,
}: {
  open: boolean
  /** null creates a new role. */
  role: AccessRole | null
  onOpenChange: (open: boolean) => void
}) {
  const { data: catalogue } = useAccessRoles(open)
  const [label, setLabel] = useState('')
  const [description, setDescription] = useState('')
  const [constraints, setConstraints] = useState<AccessRoleConstraints>(
    unrestrictedConstraints,
  )
  const [memberUserIds, setMemberUserIds] = useState<string[]>([])
  const [tab, setTab] = useState('general')

  // A fresh draft every time the dialog opens, seeded from the edited role.
  useEffect(() => {
    if (!open) return
    setLabel(role?.label ?? '')
    setDescription(role?.description ?? '')
    setConstraints(role?.constraints ?? unrestrictedConstraints())
    setMemberUserIds(role?.memberUserIds ?? [])
    setTab('general')
  }, [open, role])

  const patch = (partial: Partial<AccessRoleConstraints>) =>
    setConstraints((previous) => ({ ...previous, ...partial }))

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        label: label.trim(),
        description: description.trim(),
        constraints,
        memberUserIds,
      }
      return role === null
        ? createAccessRole(payload)
        : updateAccessRole(role.id, payload)
    },
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.accessAll })
      toast.success(
        role === null
          ? t('accessRoles.created', 'The role "{0}" has been created.', [
              response.role.label,
            ])
          : t('accessRoles.saved', 'The role "{0}" has been saved.', [
              response.role.label,
            ]),
      )
      onOpenChange(false)
    },
    onError: (error) =>
      toast.error(
        apiErrorDescription(
          error,
          t('accessRoles.saveFailedDetail', 'Saving the role failed.'),
        ),
        { title: t('accessRoles.saveFailed', 'Could not save role') },
      ),
  })

  const canSubmit = label.trim() !== ''

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Wider than the xl preset: seven tabs do not fit its width in every
          language (German "Berechtigungen" alone overflows it), and the tab
          strip would scroll by a few dozen pixels - which reads as a
          cut-off tab, not as something scrollable. The page-tree picker
          inside earns the extra room anyway. */}
      <DialogContent size="xl" className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>
            {role === null
              ? t('accessRoles.newRole', 'New role')
              : t('accessRoles.editRole', 'Edit role')}
            {role !== null && (
              <span className="ml-2 font-normal text-neutral-600 dark:text-neutral-400">
                {role.label}
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            {t(
              'accessRoles.dialogHint',
              'Everything left untouched stays open. Members keep their Neos roles — this only narrows where those roles apply.',
            )}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(next) => setTab(String(next))}>
          <TabsList>
            <TabsTrigger value="general">
              <i className="fas fa-circle-info" aria-hidden />
              {t('accessRoles.tabGeneral', 'General')}
            </TabsTrigger>
            <TabsTrigger value="sites">
              <i className="fas fa-globe" aria-hidden />
              {t('accessRoles.tabSites', 'Sites')}
            </TabsTrigger>
            <TabsTrigger value="tree">
              <i className="fas fa-sitemap" aria-hidden />
              {t('accessRoles.tabTree', 'Documents')}
            </TabsTrigger>
            <TabsTrigger value="dimensions">
              <i className="fas fa-language" aria-hidden />
              {t('accessRoles.tabDimensions', 'Dimensions')}
            </TabsTrigger>
            <TabsTrigger value="workspaces">
              <i className="fas fa-layer-group" aria-hidden />
              {t('accessRoles.tabWorkspaces', 'Workspaces')}
            </TabsTrigger>
            <TabsTrigger value="capabilities">
              <i className="fas fa-key" aria-hidden />
              {t('accessRoles.tabCapabilities', 'Permissions')}
            </TabsTrigger>
            <TabsTrigger value="members">
              <i className="fas fa-users" aria-hidden />
              {t('accessRoles.tabMembers', 'Members')}
            </TabsTrigger>
          </TabsList>

          {/* flex-none: the base flex-1 has basis 0%, which an auto-height
              flex column resolves as "content" - the panel would grow with an
              expanded page tree and push the dialog past the viewport. */}
          <TabsContent
            value="general"
            className="h-[26rem] max-h-[55vh] min-h-0 flex-none overflow-y-auto p-4"
          >
            <div className="space-y-4">
              <Field
                label={t('accessRoles.label', 'Name')}
                htmlFor="access-role-label"
              >
                <Input
                  id="access-role-label"
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder={t(
                    'accessRoles.labelPlaceholder',
                    'e.g. Editors North',
                  )}
                  autoComplete="off"
                  required
                />
              </Field>
              <Field
                label={t('accessRoles.description', 'Description')}
                htmlFor="access-role-description"
              >
                <Textarea
                  id="access-role-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={3}
                  placeholder={t(
                    'accessRoles.descriptionPlaceholder',
                    'What this role is for — the next administrator will thank you.',
                  )}
                />
              </Field>
              {role !== null && (
                <p className="text-xs text-neutral-500">
                  {t('accessRoles.identifierHint', 'Identifier: {0}', [
                    role.identifier,
                  ])}
                </p>
              )}
            </div>
          </TabsContent>

          <TabsContent
            value="sites"
            className="h-[26rem] max-h-[55vh] min-h-0 flex-none overflow-y-auto p-4"
          >
            <SitesTab
              selected={constraints.siteNodeNames}
              onChange={(siteNodeNames) => patch({ siteNodeNames })}
            />
          </TabsContent>

          <TabsContent
            value="tree"
            className="h-[26rem] max-h-[55vh] min-h-0 flex-none overflow-y-auto p-4"
          >
            <TreeTab
              allowedSiteNodeNames={constraints.siteNodeNames}
              rules={constraints.nodeTreeRules}
              onChange={(nodeTreeRules) => patch({ nodeTreeRules })}
            />
          </TabsContent>

          <TabsContent
            value="dimensions"
            className="h-[26rem] max-h-[55vh] min-h-0 flex-none overflow-y-auto p-4"
          >
            <DimensionsTab
              selected={constraints.dimensionValues}
              onChange={(dimensionValues) => patch({ dimensionValues })}
            />
          </TabsContent>

          <TabsContent
            value="workspaces"
            className="h-[26rem] max-h-[55vh] min-h-0 flex-none overflow-y-auto p-4"
          >
            <WorkspacesTab constraints={constraints} onChange={patch} />
          </TabsContent>

          <TabsContent
            value="capabilities"
            className="h-[26rem] max-h-[55vh] min-h-0 flex-none overflow-y-auto p-4"
          >
            <CapabilitiesTab
              capabilities={constraints.capabilities}
              available={catalogue?.capabilities ?? []}
              onChange={(capabilities) => patch({ capabilities })}
            />
          </TabsContent>

          <TabsContent
            value="members"
            className="h-[26rem] max-h-[55vh] min-h-0 flex-none overflow-y-auto p-4"
          >
            <MembersTab
              selected={memberUserIds}
              bypassRoles={catalogue?.bypassRoles ?? []}
              onChange={setMemberUserIds}
            />
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button
            type="button"
            disabled={!canSubmit || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending
              ? t('accessRoles.saving', 'Saving…')
              : role === null
                ? t('accessRoles.create', 'Create role')
                : t('accessRoles.save', 'Save role')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The shared shape of every restriction tab: one sentence saying what "leave
 * everything unticked" means, then the list. Stating the default in the tab
 * itself is what keeps the empty-means-everything convention from reading as
 * a bug.
 */
function TabIntro({ children }: { children: ReactNode }) {
  return (
    <p className="mb-3 text-sm text-neutral-600 dark:text-neutral-400">
      {children}
    </p>
  )
}

function CheckboxRow({
  checked,
  onCheckedChange,
  disabled,
  children,
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-sm px-1 py-1 text-sm text-neutral-800 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800 has-[[disabled]]:cursor-not-allowed has-[[disabled]]:opacity-60">
      <Checkbox
        className="mt-0.5"
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => onCheckedChange(next === true)}
      />
      <span className="min-w-0">{children}</span>
    </label>
  )
}

function toggle(list: string[], value: string, checked: boolean): string[] {
  return checked ? [...list, value] : list.filter((entry) => entry !== value)
}

function SitesTab({
  selected,
  onChange,
}: {
  selected: string[]
  onChange: (siteNodeNames: string[]) => void
}) {
  const { data } = useSites('live', null)
  const sites = data?.sites ?? []

  return (
    <>
      <TabIntro>
        {t(
          'accessRoles.sitesHint',
          'Tick the sites this role may work on. Nothing ticked means every site — including sites added later.',
        )}
      </TabIntro>
      {sites.length === 0 ? (
        <Placeholder
          icon="fa-globe"
          title={t('sites.none', 'No sites found.')}
        />
      ) : (
        <div className="space-y-0.5">
          {sites.map((site) => (
            <CheckboxRow
              key={site.nodeName}
              checked={selected.includes(site.nodeName)}
              onCheckedChange={(checked) =>
                onChange(toggle(selected, site.nodeName, checked))
              }
            >
              {site.name}
              <span className="ml-2 text-xs text-neutral-500">
                {site.nodeName}
              </span>
              {site.state === 'offline' && (
                <Badge variant="secondary" className="ml-2">
                  {t('sites.offline', 'Offline')}
                </Badge>
              )}
            </CheckboxRow>
          ))}
        </div>
      )}
    </>
  )
}

function TreeTab({
  allowedSiteNodeNames,
  rules,
  onChange,
}: {
  allowedSiteNodeNames: string[]
  rules: NodeTreeRule[]
  onChange: (rules: NodeTreeRule[]) => void
}) {
  const { data } = useSites('live', null)
  // Only sites the role can reach at all - browsing a site it is excluded
  // from would invite rules that can never fire.
  const sites = (data?.sites ?? []).filter(
    (site) =>
      allowedSiteNodeNames.length === 0 ||
      allowedSiteNodeNames.includes(site.nodeName),
  )

  return <NodeTreeRuleEditor sites={sites} rules={rules} onChange={onChange} />
}

function DimensionsTab({
  selected,
  onChange,
}: {
  selected: Record<string, string[]>
  onChange: (dimensionValues: Record<string, string[]>) => void
}) {
  const { data } = useDimensions()
  const dimensions = data?.dimensions ?? []

  const setValues = (dimensionId: string, values: string[]) => {
    const next = { ...selected }
    // An empty list is the same as no restriction; keeping the key would make
    // the role look narrower than it is (and the server drops it anyway).
    if (values.length === 0) delete next[dimensionId]
    else next[dimensionId] = values
    onChange(next)
  }

  if (dimensions.length === 0) {
    return (
      <Placeholder
        icon="fa-language"
        title={t(
          'accessRoles.dimensionsNone',
          'This installation has no content dimensions.',
        )}
      />
    )
  }

  return (
    <>
      <TabIntro>
        {t(
          'accessRoles.dimensionsHint',
          'Tick the dimension values this role may edit. A dimension with nothing ticked stays fully open.',
        )}
      </TabIntro>
      <div className="space-y-4">
        {dimensions.map((dimension) => {
          const values = selected[dimension.id] ?? []
          return (
            <div key={dimension.id}>
              <div className="mb-1 text-sm font-medium text-neutral-800 dark:text-neutral-200">
                {dimension.label}
                {values.length === 0 && (
                  <span className="ml-2 text-xs font-normal text-neutral-500">
                    {t('accessRoles.dimensionAll', 'all values')}
                  </span>
                )}
              </div>
              <div className="space-y-0.5">
                {dimension.values.map((value) => (
                  <CheckboxRow
                    key={value.value}
                    checked={values.includes(value.value)}
                    onCheckedChange={(checked) =>
                      setValues(
                        dimension.id,
                        toggle(values, value.value, checked),
                      )
                    }
                  >
                    <span
                      style={{
                        paddingLeft: `${value.specializationDepth * 12}px`,
                      }}
                    >
                      {value.label}
                    </span>
                  </CheckboxRow>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

function WorkspacesTab({
  constraints,
  onChange,
}: {
  constraints: AccessRoleConstraints
  onChange: (partial: Partial<AccessRoleConstraints>) => void
}) {
  const { data } = useWorkspaces()
  // Live is listed too, not just the shared workspaces: ticking any of them
  // takes live off the list as well, so an administrator who wants "Entwurf
  // and live" has to be able to say so.
  const selectable = (data?.workspaces ?? []).filter(
    (workspace) =>
      workspace.classification === 'SHARED' ||
      workspace.classification === 'ROOT',
  )

  return (
    <>
      <TabIntro>
        {t(
          'accessRoles.workspacesHint',
          'Which workspaces this role may work in — edit in, publish into, join collaboratively. Nothing ticked means all of them, including live. Tick any and everything else is out, live included. Live stays readable either way; the website is rendered from it.',
        )}
      </TabIntro>

      {selectable.length === 0 ? (
        <Placeholder
          icon="fa-layer-group"
          title={t(
            'accessRoles.workspacesNone',
            'There are no shared workspaces yet.',
          )}
          className="py-6"
        />
      ) : (
        <div className="space-y-0.5">
          {selectable.map((workspace) => (
            <CheckboxRow
              key={workspace.name}
              checked={constraints.workspaceNames.includes(workspace.name)}
              onCheckedChange={(checked) =>
                onChange({
                  workspaceNames: toggle(
                    constraints.workspaceNames,
                    workspace.name,
                    checked,
                  ),
                })
              }
            >
              {workspace.title || workspace.name}
              <span className="ml-2 text-xs text-neutral-500">
                {workspace.name}
              </span>
              {workspace.classification === 'ROOT' && (
                <Badge variant="secondary" className="ml-2">
                  {t('accessRoles.workspaceLive', 'Live')}
                </Badge>
              )}
            </CheckboxRow>
          ))}
        </div>
      )}

      <div className="mt-5 space-y-0.5 border-t pt-4">
        <CheckboxRow
          checked={constraints.allowPersonalWorkspace}
          onCheckedChange={(checked) =>
            onChange({ allowPersonalWorkspace: checked })
          }
        >
          {t('accessRoles.allowPersonal', 'May use their personal workspace')}
          <span className="block text-xs text-neutral-500">
            {t(
              'accessRoles.allowPersonalHint',
              'Off forces this role to edit directly in a shared workspace.',
            )}
          </span>
        </CheckboxRow>
        <CheckboxRow
          checked={constraints.allowPublishToLive}
          onCheckedChange={(checked) =>
            onChange({ allowPublishToLive: checked })
          }
        >
          {t('accessRoles.allowPublish', 'May publish to live')}
          <span className="block text-xs text-neutral-500">
            {t(
              'accessRoles.allowPublishHint',
              'Off means changes can only be handed on for review.',
            )}
          </span>
        </CheckboxRow>
        <CheckboxRow
          checked={constraints.allowWorkspaceCreation}
          onCheckedChange={(checked) =>
            onChange({ allowWorkspaceCreation: checked })
          }
        >
          {t('accessRoles.allowWorkspaceCreation', 'May create workspaces')}
        </CheckboxRow>
      </div>
    </>
  )
}

const CAPABILITY_ORDER: AccessCapability[] = [
  'editNodes',
  'createNodes',
  'deleteNodes',
  'moveNodes',
]

/**
 * Resolved at render time, not at module scope: translations are fetched
 * before the app mounts, so labels baked into a module constant would be the
 * untranslated fallbacks forever.
 */
function capabilityLabel(
  capability: AccessCapability,
): { label: string; hint: string } | null {
  switch (capability) {
    case 'editNodes':
      return {
        label: t('accessRoles.capEdit', 'Edit content'),
        hint: t(
          'accessRoles.capEditHint',
          'Change properties, references, and show/hide pages.',
        ),
      }
    case 'createNodes':
      return {
        label: t('accessRoles.capCreate', 'Create pages and content'),
        hint: t(
          'accessRoles.capCreateHint',
          'Also covers creating a page in another dimension.',
        ),
      }
    case 'deleteNodes':
      return {
        label: t('accessRoles.capDelete', 'Delete pages and content'),
        hint: '',
      }
    case 'moveNodes':
      return {
        label: t('accessRoles.capMove', 'Move pages and content'),
        hint: t(
          'accessRoles.capMoveHint',
          'Reordering and drag-and-drop in the page tree.',
        ),
      }
    default:
      // A capability the server knows and this build does not - skip it
      // rather than render an unlabelled checkbox.
      return null
  }
}

function CapabilitiesTab({
  capabilities,
  available,
  onChange,
}: {
  capabilities: Partial<Record<AccessCapability, boolean>>
  available: AccessCapability[]
  onChange: (capabilities: Partial<Record<AccessCapability, boolean>>) => void
}) {
  // The server reports the capabilities it knows; fall back to the labelled
  // set so the tab is populated before the catalogue resolves.
  const names = useMemo(
    () =>
      (available.length > 0 ? available : CAPABILITY_ORDER)
        .map((name) => ({ name, labels: capabilityLabel(name) }))
        .filter(
          (
            entry,
          ): entry is {
            name: AccessCapability
            labels: { label: string; hint: string }
          } => entry.labels !== null,
        ),
    [available],
  )

  const setGranted = (capability: AccessCapability, granted: boolean) => {
    const next = { ...capabilities }
    // Only withheld capabilities are stored - see AccessRoleConstraints.
    if (granted) delete next[capability]
    else next[capability] = false
    onChange(next)
  }

  return (
    <>
      <TabIntro>
        {t(
          'accessRoles.capabilitiesHint',
          'What members may do inside everything above. Untick to take a capability away.',
        )}
      </TabIntro>
      <div className="space-y-0.5">
        {names.map(({ name, labels }) => (
          <CheckboxRow
            key={name}
            checked={capabilities[name] !== false}
            onCheckedChange={(checked) => setGranted(name, checked)}
          >
            {labels.label}
            {labels.hint !== '' && (
              <span className="block text-xs text-neutral-500">
                {labels.hint}
              </span>
            )}
          </CheckboxRow>
        ))}
      </div>
    </>
  )
}

function MembersTab({
  selected,
  bypassRoles,
  onChange,
}: {
  selected: string[]
  bypassRoles: string[]
  onChange: (userIds: string[]) => void
}) {
  const { data } = useUsers()
  const [search, setSearch] = useState('')

  const users = useMemo(() => {
    const all = data?.users ?? []
    const term = search.trim().toLowerCase()
    if (term === '') return all
    return all.filter((user) =>
      [user.fullName, user.label, user.email ?? '']
        .join(' ')
        .toLowerCase()
        .includes(term),
    )
  }, [data, search])

  return (
    <>
      <TabIntro>
        {t(
          'accessRoles.membersHint',
          'Who this role applies to. Roles are additive: someone in two roles may do what either allows.',
        )}
      </TabIntro>
      <Input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder={t('users.search', 'Search users…')}
        className="mb-3 max-w-xs"
        autoComplete="off"
      />
      <div className="space-y-0.5">
        {users.map((user) => {
          // Administrators (and whoever else bypasses access control) are
          // exempt by design - a membership would look like it does something.
          const bypassed = user.roles.find((identifier) =>
            bypassRoles.includes(identifier),
          )
          return (
            <CheckboxRow
              key={user.id}
              checked={selected.includes(user.id)}
              disabled={bypassed !== undefined}
              onCheckedChange={(checked) =>
                onChange(toggle(selected, user.id, checked))
              }
            >
              {user.fullName || user.label}
              {bypassed !== undefined && (
                <Badge variant="outline" className="ml-2">
                  {t('accessRoles.memberExempt', 'Exempt: {0}', [bypassed])}
                </Badge>
              )}
              {!user.active && (
                <Badge variant="secondary" className="ml-2">
                  {t('users.inactive', 'Inactive')}
                </Badge>
              )}
            </CheckboxRow>
          )
        })}
      </div>
    </>
  )
}
