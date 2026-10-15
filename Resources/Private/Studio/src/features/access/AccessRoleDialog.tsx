import { useId, useMemo, useState, type ReactNode } from 'react'
import { useMutation } from '@tanstack/react-query'

import { apiErrorDescription } from '@/api/http/errors'
import { useContentRepository } from '@/api/neos/endpoints/contentRepositories'
import { useSites } from '@/api/neos/endpoints/sites'
import { userRoles, useUsers } from '@/api/neos/endpoints/users'
import { useWorkspaces } from '@/api/neos/endpoints/workspaces'
import {
  createAccessRole,
  updateAccessRole,
  useAccessRoles,
} from '@/api/studio/endpoints/accessRoles'
import { studioKeys } from '@/api/studio/keys'
import type {
  AccessCapability,
  AccessRole,
  AccessRoleConstraints,
  NodeTreeRule,
} from '@/api/studio/schema'
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
import { fullName } from '@/features/users/user'
import { NodeTreeRuleEditor } from './NodeTreeRuleEditor'
import { unrestrictedConstraints } from './rules'

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
 * Roles restrict WRITING only. The server answers reads for everyone - a
 * member outside a site still sees it, they just cannot change it - and the
 * dialog's wording says so throughout.
 *
 * The dialog is permissive-by-default: a fresh role restricts nothing. The
 * stored model is "empty means unrestricted" (an empty site list is every
 * site), which the dialog does NOT expose as "nothing ticked": each list axis
 * has an explicit "All / Only the selected" choice, so unticking the last
 * site of a restricted role cannot silently widen it to every site - an empty
 * selection is incomplete and blocks saving instead.
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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Wider than the xl preset: seven tabs do not fit its width in every
          language (German "Berechtigungen" alone overflows it), and the tab
          strip would scroll by a few dozen pixels - which reads as a
          cut-off tab, not as something scrollable. The page-tree picker
          inside earns the extra room anyway. */}
      <DialogContent size="xl" className="max-w-5xl">
        {/* The popup unmounts while closed, so every opening mounts a fresh
            form seeded from the role - and a refetch of the role while it
            is open (another tab saved it) does not wipe the draft. */}
        <AccessRoleForm
          key={role?.id ?? 'new'}
          role={role}
          onOpenChange={onOpenChange}
        />
      </DialogContent>
    </Dialog>
  )
}

function AccessRoleForm({
  role,
  onOpenChange,
}: {
  role: AccessRole | null
  onOpenChange: (open: boolean) => void
}) {
  const { data: catalogue } = useAccessRoles()
  const [label, setLabel] = useState(() => role?.label ?? '')
  const [description, setDescription] = useState(() => role?.description ?? '')
  const [constraints, setConstraints] = useState<AccessRoleConstraints>(
    () => role?.constraints ?? unrestrictedConstraints(),
  )
  // Which list axes are narrowed to a selection. Kept apart from the lists,
  // so switching an axis to "All" and back restores the ticks, and so an
  // empty selection stays a visible, incomplete restriction.
  const [restrictSites, setRestrictSites] = useState(
    () => constraints.siteNodeNames.length > 0,
  )
  const [restrictWorkspaces, setRestrictWorkspaces] = useState(
    () => constraints.workspaceNames.length > 0,
  )
  const [restrictedDimensions, setRestrictedDimensions] = useState(() =>
    Object.entries(constraints.dimensionValues)
      .filter(([, values]) => values.length > 0)
      .map(([dimensionId]) => dimensionId),
  )
  const [memberUserIds, setMemberUserIds] = useState<string[]>(
    () => role?.memberUserIds ?? [],
  )
  const [tab, setTab] = useState('general')

  const patch = (partial: Partial<AccessRoleConstraints>) =>
    setConstraints((previous) => ({ ...previous, ...partial }))

  // What the server stores: an axis on "All" is the empty list.
  const effectiveConstraints: AccessRoleConstraints = {
    ...constraints,
    siteNodeNames: restrictSites ? constraints.siteNodeNames : [],
    workspaceNames: restrictWorkspaces ? constraints.workspaceNames : [],
    dimensionValues: Object.fromEntries(
      restrictedDimensions.map((dimensionId) => [
        dimensionId,
        constraints.dimensionValues[dimensionId] ?? [],
      ]),
    ),
  }
  const sitesIncomplete =
    restrictSites && constraints.siteNodeNames.length === 0
  const workspacesIncomplete =
    restrictWorkspaces && constraints.workspaceNames.length === 0
  const dimensionsIncomplete = restrictedDimensions.some(
    (dimensionId) =>
      (constraints.dimensionValues[dimensionId] ?? []).length === 0,
  )
  const incomplete =
    sitesIncomplete || workspacesIncomplete || dimensionsIncomplete

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        label: label.trim(),
        description: description.trim(),
        constraints: effectiveConstraints,
        memberUserIds,
      }
      return role === null
        ? createAccessRole(payload)
        : updateAccessRole(role.id, payload)
    },
    onSuccess: (response) => {
      void queryClient.invalidateQueries({ queryKey: studioKeys.access.all })
      toast.success(
        role === null
          ? t('accessRoles.created', 'The role "{0}" has been created.', [
              response.label,
            ])
          : t('accessRoles.saved', 'The role "{0}" has been saved.', [
              response.label,
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

  const canSubmit = label.trim() !== '' && !incomplete

  return (
    <>
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
            'accessRoles.dialogHintWriting',
            'A role restricts what its members may change, not what they may see: content stays readable everywhere. Members keep their Neos roles — this only narrows where they may write. Everything left on "All" stays open.',
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
            {sitesIncomplete && <IncompleteMark />}
          </TabsTrigger>
          <TabsTrigger value="tree">
            <i className="fas fa-sitemap" aria-hidden />
            {t('accessRoles.tabTree', 'Documents')}
          </TabsTrigger>
          <TabsTrigger value="dimensions">
            <i className="fas fa-language" aria-hidden />
            {t('accessRoles.tabDimensions', 'Dimensions')}
            {dimensionsIncomplete && <IncompleteMark />}
          </TabsTrigger>
          <TabsTrigger value="workspaces">
            <i className="fas fa-layer-group" aria-hidden />
            {t('accessRoles.tabWorkspaces', 'Workspaces')}
            {workspacesIncomplete && <IncompleteMark />}
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
            restricted={restrictSites}
            onRestrictedChange={setRestrictSites}
            selected={constraints.siteNodeNames}
            onChange={(siteNodeNames) => patch({ siteNodeNames })}
          />
        </TabsContent>

        <TabsContent
          value="tree"
          className="h-[26rem] max-h-[55vh] min-h-0 flex-none overflow-y-auto p-4"
        >
          <TreeTab
            allowedSiteNodeNames={effectiveConstraints.siteNodeNames}
            rules={constraints.nodeTreeRules}
            onChange={(nodeTreeRules) => patch({ nodeTreeRules })}
          />
        </TabsContent>

        <TabsContent
          value="dimensions"
          className="h-[26rem] max-h-[55vh] min-h-0 flex-none overflow-y-auto p-4"
        >
          <DimensionsTab
            restricted={restrictedDimensions}
            onRestrictedChange={setRestrictedDimensions}
            selected={constraints.dimensionValues}
            onChange={(dimensionValues) => patch({ dimensionValues })}
          />
        </TabsContent>

        <TabsContent
          value="workspaces"
          className="h-[26rem] max-h-[55vh] min-h-0 flex-none overflow-y-auto p-4"
        >
          <WorkspacesTab
            constraints={constraints}
            restricted={restrictWorkspaces}
            onRestrictedChange={setRestrictWorkspaces}
            onChange={patch}
          />
        </TabsContent>

        <TabsContent
          value="capabilities"
          className="h-[26rem] max-h-[55vh] min-h-0 flex-none overflow-y-auto p-4"
        >
          <CapabilitiesTab
            capabilities={constraints.capabilities}
            available={catalogue?.meta.capabilities ?? []}
            onChange={(capabilities) => patch({ capabilities })}
          />
        </TabsContent>

        <TabsContent
          value="members"
          className="h-[26rem] max-h-[55vh] min-h-0 flex-none overflow-y-auto p-4"
        >
          <MembersTab
            selected={memberUserIds}
            bypassRoles={catalogue?.meta.bypassRoles ?? []}
            onChange={setMemberUserIds}
          />
        </TabsContent>
      </Tabs>

      <DialogFooter>
        {incomplete && (
          <p className="mr-auto self-center text-sm text-amber-700 dark:text-amber-400">
            <i className="fas fa-circle-exclamation mr-1.5" aria-hidden />
            {t(
              'accessRoles.incomplete',
              'A restriction has nothing selected. Select something, or switch it back to "All".',
            )}
          </p>
        )}
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
    </>
  )
}

/**
 * The sentence that opens a restriction tab: what the axis narrows, and that
 * it narrows writing only.
 */
function TabIntro({ children }: { children: ReactNode }) {
  return (
    <p className="mb-3 text-sm text-neutral-600 dark:text-neutral-400">
      {children}
    </p>
  )
}

/**
 * The explicit "All / Only the selected" choice of a list axis. "All" is what
 * the server stores as the empty list; spelling it out is what keeps an empty
 * selection from silently meaning "everything".
 */
function ScopeChoice({
  legend,
  restricted,
  onChange,
  allLabel,
  selectedLabel,
}: {
  legend: ReactNode
  restricted: boolean
  onChange: (restricted: boolean) => void
  allLabel: string
  selectedLabel: string
}) {
  const name = useId()
  return (
    <fieldset className="mb-2">
      <legend className="mb-1.5 text-sm text-neutral-600 dark:text-neutral-400">
        {legend}
      </legend>
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        {[false, true].map((value) => (
          <label
            key={String(value)}
            className="flex cursor-pointer items-center gap-2 rounded-sm px-1 py-1 text-sm text-neutral-800 dark:text-neutral-200"
          >
            <input
              type="radio"
              name={name}
              className="size-4 accent-blue-500"
              checked={restricted === value}
              onChange={() => onChange(value)}
            />
            {value ? selectedLabel : allLabel}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

/** Marks a tab whose restriction has nothing selected. */
function IncompleteMark() {
  return (
    <i
      className="fas fa-circle-exclamation text-amber-500"
      title={t(
        'accessRoles.incomplete',
        'A restriction has nothing selected. Select something, or switch it back to "All".',
      )}
      aria-hidden
    />
  )
}

function IncompleteNote({ children }: { children: ReactNode }) {
  return (
    <p className="mt-2 px-1 text-sm text-amber-700 dark:text-amber-400">
      <i className="fas fa-circle-exclamation mr-1.5" aria-hidden />
      {children}
    </p>
  )
}

/**
 * Marks a selected entry that no longer exists - a deleted site or
 * workspace, a dimension value the content repository dropped. It still
 * counts on the server, so it is listed; unticking removes it.
 */
function MissingBadge() {
  return (
    <Badge
      variant="outline"
      className="ml-2"
      title={t(
        'accessRoles.missingHint',
        'This no longer exists. Untick it to remove it from the role.',
      )}
    >
      {t('accessRoles.missing', '(missing)')}
    </Badge>
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
  restricted,
  onRestrictedChange,
  selected,
  onChange,
}: {
  restricted: boolean
  onRestrictedChange: (restricted: boolean) => void
  selected: string[]
  onChange: (siteNodeNames: string[]) => void
}) {
  const { data } = useSites()
  const sites = data ?? []
  // Only once the sites are known - before that, everything would look gone.
  const missing =
    data === undefined
      ? []
      : selected.filter(
          (nodeName) => !sites.some((site) => site.nodeName === nodeName),
        )

  return (
    <>
      <ScopeChoice
        legend={t(
          'accessRoles.sitesHintWriting',
          'The sites members may make changes on. All other sites stay readable.',
        )}
        restricted={restricted}
        onChange={onRestrictedChange}
        allLabel={t(
          'accessRoles.sitesScopeAll',
          'All sites — including sites added later',
        )}
        selectedLabel={t(
          'accessRoles.sitesScopeSelected',
          'Only the selected sites',
        )}
      />
      {restricted &&
        (sites.length === 0 && missing.length === 0 ? (
          <Placeholder
            icon="fa-globe"
            title={t('sites.none', 'No sites found.')}
          />
        ) : (
          <div className="space-y-0.5 pl-6">
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
                {!site.online && (
                  <Badge variant="secondary" className="ml-2">
                    {t('sites.offline', 'Offline')}
                  </Badge>
                )}
              </CheckboxRow>
            ))}
            {missing.map((nodeName) => (
              <CheckboxRow
                key={nodeName}
                checked
                onCheckedChange={() =>
                  onChange(toggle(selected, nodeName, false))
                }
              >
                {nodeName}
                <MissingBadge />
              </CheckboxRow>
            ))}
            {selected.length === 0 && (
              <IncompleteNote>
                {t(
                  'accessRoles.sitesEmpty',
                  'Select at least one site, or allow all sites.',
                )}
              </IncompleteNote>
            )}
          </div>
        ))}
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
  const { data } = useSites()
  // Only sites the role can reach at all - browsing a site it is excluded
  // from would invite rules that can never fire.
  const sites = (data ?? []).filter(
    (site) =>
      allowedSiteNodeNames.length === 0 ||
      allowedSiteNodeNames.includes(site.nodeName),
  )

  return <NodeTreeRuleEditor sites={sites} rules={rules} onChange={onChange} />
}

function DimensionsTab({
  restricted,
  onRestrictedChange,
  selected,
  onChange,
}: {
  /** The ids of the dimensions narrowed to a selection. */
  restricted: string[]
  onRestrictedChange: (restricted: string[]) => void
  selected: Record<string, string[]>
  onChange: (dimensionValues: Record<string, string[]>) => void
}) {
  const { data } = useContentRepository()
  const known = (data?.dimensions ?? []).map((dimension) => ({
    id: dimension.id,
    label: dimension.label ?? dimension.id,
    values: dimension.values.map((value) => ({
      value: value.value,
      label: value.label ?? value.value,
      depth: value.specializationDepth,
    })),
    missing: false,
  }))
  // Restricted dimensions the content repository no longer has: still
  // stored, so still listed - with their values all marked missing.
  const orphaned =
    data === undefined
      ? []
      : restricted
          .filter((id) => !known.some((dimension) => dimension.id === id))
          .map((id) => ({ id, label: id, values: [], missing: true }))
  const dimensions = [...known, ...orphaned]

  const setValues = (dimensionId: string, values: string[]) =>
    onChange({ ...selected, [dimensionId]: values })

  const setRestricted = (dimensionId: string, narrowed: boolean) =>
    onRestrictedChange(
      narrowed
        ? [...restricted, dimensionId]
        : restricted.filter((id) => id !== dimensionId),
    )

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
          'accessRoles.dimensionsHintWriting',
          'The dimension values members may make changes in. Content in all other values stays readable.',
        )}
      </TabIntro>
      <div className="space-y-4">
        {dimensions.map((dimension) => {
          const values = selected[dimension.id] ?? []
          const isRestricted = restricted.includes(dimension.id)
          const missing =
            data === undefined
              ? []
              : values.filter(
                  (value) =>
                    !dimension.values.some((known) => known.value === value),
                )
          return (
            <div key={dimension.id}>
              <ScopeChoice
                legend={
                  <span className="font-medium text-neutral-800 dark:text-neutral-200">
                    {dimension.label}
                    {dimension.missing && <MissingBadge />}
                  </span>
                }
                restricted={isRestricted}
                onChange={(narrowed) => setRestricted(dimension.id, narrowed)}
                allLabel={t('accessRoles.dimensionScopeAll', 'All values')}
                selectedLabel={t(
                  'accessRoles.dimensionScopeSelected',
                  'Only the selected values',
                )}
              />
              {isRestricted && (
                <div className="space-y-0.5 pl-6">
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
                      <span style={{ paddingLeft: `${value.depth * 12}px` }}>
                        {value.label}
                      </span>
                    </CheckboxRow>
                  ))}
                  {missing.map((value) => (
                    <CheckboxRow
                      key={value}
                      checked
                      onCheckedChange={() =>
                        setValues(dimension.id, toggle(values, value, false))
                      }
                    >
                      {value}
                      <MissingBadge />
                    </CheckboxRow>
                  ))}
                  {values.length === 0 && (
                    <IncompleteNote>
                      {t(
                        'accessRoles.dimensionEmpty',
                        'Select at least one value, or allow all values.',
                      )}
                    </IncompleteNote>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}

function WorkspacesTab({
  constraints,
  restricted,
  onRestrictedChange,
  onChange,
}: {
  constraints: AccessRoleConstraints
  restricted: boolean
  onRestrictedChange: (restricted: boolean) => void
  onChange: (partial: Partial<AccessRoleConstraints>) => void
}) {
  const { data } = useWorkspaces()
  // Live is listed too, not just the shared workspaces: a selection takes
  // live off the list as well, so an administrator who wants "Entwurf and
  // live" has to be able to say so.
  const selectable = (data ?? []).filter(
    (workspace) =>
      workspace.classification === 'shared' ||
      workspace.classification === 'root',
  )
  const selected = constraints.workspaceNames
  const missing =
    data === undefined
      ? []
      : selected.filter(
          (name) => !selectable.some((workspace) => workspace.name === name),
        )

  return (
    <>
      <ScopeChoice
        legend={t(
          'accessRoles.workspacesHintWriting',
          'Which workspaces members may work in — edit in, publish into, join collaboratively. With a selection, every other workspace is out, live included. All workspaces stay readable; the website is rendered from live.',
        )}
        restricted={restricted}
        onChange={onRestrictedChange}
        allLabel={t(
          'accessRoles.workspacesScopeAll',
          'All workspaces, including live',
        )}
        selectedLabel={t(
          'accessRoles.workspacesScopeSelected',
          'Only the selected workspaces',
        )}
      />

      {restricted &&
        (selectable.length === 0 && missing.length === 0 ? (
          <Placeholder
            icon="fa-layer-group"
            title={t(
              'accessRoles.workspacesNone',
              'There are no shared workspaces yet.',
            )}
            className="py-6"
          />
        ) : (
          <div className="space-y-0.5 pl-6">
            {selectable.map((workspace) => (
              <CheckboxRow
                key={workspace.name}
                checked={selected.includes(workspace.name)}
                onCheckedChange={(checked) =>
                  onChange({
                    workspaceNames: toggle(selected, workspace.name, checked),
                  })
                }
              >
                {workspace.title || workspace.name}
                <span className="ml-2 text-xs text-neutral-500">
                  {workspace.name}
                </span>
                {workspace.classification === 'root' && (
                  <Badge variant="secondary" className="ml-2">
                    {t('accessRoles.workspaceLive', 'Live')}
                  </Badge>
                )}
              </CheckboxRow>
            ))}
            {missing.map((name) => (
              <CheckboxRow
                key={name}
                checked
                onCheckedChange={() =>
                  onChange({ workspaceNames: toggle(selected, name, false) })
                }
              >
                {name}
                <MissingBadge />
              </CheckboxRow>
            ))}
            {selected.length === 0 && (
              <IncompleteNote>
                {t(
                  'accessRoles.workspacesEmpty',
                  'Select at least one workspace, or allow all workspaces.',
                )}
              </IncompleteNote>
            )}
          </div>
        ))}

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
  capabilities: Record<AccessCapability, boolean>
  available: AccessCapability[]
  onChange: (capabilities: Record<AccessCapability, boolean>) => void
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
    const all = data ?? []
    const term = search.trim().toLowerCase()
    if (term === '') return all
    return all.filter((user) =>
      [fullName(user), user.label, user.email ?? '']
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
        aria-label={t('users.search', 'Search users…')}
        className="mb-3 max-w-xs"
        autoComplete="off"
      />
      <div className="space-y-0.5">
        {users.map((user) => {
          // Administrators (and whoever else bypasses access control) are
          // exempt by design - a membership would look like it does something.
          const bypassed = userRoles(user).find((identifier) =>
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
              {fullName(user) || user.label}
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
