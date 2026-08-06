import { useEffect, useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'

import { apiErrorDescription } from '@/api/client'
import { queryKeys } from '@/api/keys'
import { createSite, useSiteOptions } from '@/api/sites'
import { queryClient } from '@/app/queryClient'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toast'
import { translate as t } from '@/lib/i18n'

/**
 * Create a site: a fresh site node in the live workspace plus the Site
 * record. Site package and node type come from the /sites/options catalog;
 * the node name is derived from the name unless overridden.
 */
export function CreateSiteDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { data: options, isLoading: optionsLoading } = useSiteOptions(open)

  const [name, setName] = useState('')
  const [packageKey, setPackageKey] = useState('')
  const [nodeTypeName, setNodeTypeName] = useState('')
  const [nodeName, setNodeName] = useState('')
  const [startOffline, setStartOffline] = useState(false)

  // A fresh form every time the dialog opens.
  useEffect(() => {
    if (open) {
      setName('')
      setPackageKey('')
      setNodeTypeName('')
      setNodeName('')
      setStartOffline(false)
    }
  }, [open])

  // Preselect the only (or first) choice once the options arrive.
  useEffect(() => {
    if (!options) return
    setPackageKey((current) =>
      current === '' ? (options.packages[0]?.packageKey ?? '') : current,
    )
    setNodeTypeName((current) =>
      current === '' ? (options.nodeTypes[0]?.name ?? '') : current,
    )
  }, [options])

  const canSubmit =
    name.trim() !== '' && packageKey !== '' && nodeTypeName !== ''

  const mutation = useMutation({
    mutationFn: () =>
      createSite({
        name: name.trim(),
        packageKey,
        nodeTypeName,
        ...(nodeName.trim() !== '' ? { nodeName: nodeName.trim() } : {}),
        ...(startOffline ? { inactive: true } : {}),
      }),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sitesAll })
      toast.success(
        t('sites.created', 'The site "{0}" has been created.', [
          response.site.name,
        ]),
      )
      // The site node was created in live; a workspace forked before that
      // does not contain it until it is synchronized (rebased).
      toast.info(
        t(
          'sites.createdSyncHint',
          'Synchronize your workspace to start editing the new site.',
        ),
      )
      onOpenChange(false)
    },
    onError: (error) =>
      toast.error(
        apiErrorDescription(
          error,
          t('sites.createFailedDetail', 'Creating the site failed.'),
        ),
        { title: t('sites.createFailed', 'Could not create site') },
      ),
  })

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (canSubmit && !mutation.isPending) mutation.mutate()
  }

  const packageItems = (options?.packages ?? []).map((pkg) => ({
    value: pkg.packageKey,
    label: pkg.packageKey,
  }))
  const nodeTypeItems = (options?.nodeTypes ?? []).map((nodeType) => ({
    value: nodeType.name,
    label: nodeType.label || nodeType.name,
  }))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{t('sites.newSite', 'New site')}</DialogTitle>
          <DialogDescription>
            {t(
              'sites.newSiteHint',
              'Creates a new site with an empty site node in the live workspace.',
            )}
          </DialogDescription>
        </DialogHeader>

        {optionsLoading && (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        )}

        {options && (
          <form onSubmit={onSubmit} className="space-y-4">
            <Field label={t('sites.name', 'Name')} htmlFor="site-create-name">
              <Input
                id="site-create-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="off"
                required
              />
            </Field>

            <Field
              label={t('sites.package', 'Site package')}
              htmlFor="site-create-package"
            >
              <Select
                value={packageKey}
                onValueChange={(value) => setPackageKey(value as string)}
                items={packageItems}
              >
                <SelectTrigger id="site-create-package" className="w-full">
                  <SelectValue
                    placeholder={t('sites.selectPackage', 'Select package…')}
                  />
                </SelectTrigger>
                <SelectContent>
                  {packageItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field
              label={t('sites.nodeType', 'Site node type')}
              htmlFor="site-create-node-type"
            >
              <Select
                value={nodeTypeName}
                onValueChange={(value) => setNodeTypeName(value as string)}
                items={nodeTypeItems}
              >
                <SelectTrigger id="site-create-node-type" className="w-full">
                  <SelectValue
                    placeholder={t('sites.selectNodeType', 'Select node type…')}
                  />
                </SelectTrigger>
                <SelectContent>
                  {nodeTypeItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field
              label={t('sites.nodeName', 'Node name (optional)')}
              htmlFor="site-create-node-name"
            >
              <Input
                id="site-create-node-name"
                value={nodeName}
                onChange={(event) => setNodeName(event.target.value)}
                placeholder={t(
                  'sites.nodeNamePlaceholder',
                  'Derived from the name when empty',
                )}
                autoComplete="off"
              />
            </Field>

            <label className="flex cursor-pointer items-center gap-2.5 text-sm text-neutral-800 dark:text-neutral-200">
              <Checkbox
                checked={startOffline}
                onCheckedChange={(checked) => setStartOffline(checked === true)}
              />
              {t('sites.startOffline', 'Start offline (hidden from visitors)')}
            </label>

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
                type="submit"
                disabled={!canSubmit || mutation.isPending}
              >
                {mutation.isPending
                  ? t('sites.creating', 'Creating…')
                  : t('sites.create', 'Create site')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
