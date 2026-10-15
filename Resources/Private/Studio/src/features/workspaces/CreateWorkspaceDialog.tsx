import { useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'

import { apiErrorDescription } from '@/api/http/errors'
import { useActiveContentRepositoryId } from '@/api/neos/activeContentRepository'
import { createWorkspace } from '@/api/neos/endpoints/workspaces'
import type { Workspace, WorkspaceCreate } from '@/api/neos/schema'
import { Button } from '@/components/ui/button'
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
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/components/ui/toast'
import { invalidateWorkspaceQueries } from '@/features/workspaces/invalidate'
import { useValueChange } from '@/hooks/use-value-change'
import { translate as t } from '@/lib/i18n'

/** public: every editor may collaborate; private: only the creator. */
type Visibility = NonNullable<WorkspaceCreate['visibility']>

/**
 * Create a shared or private workspace. The base workspace is picked from the
 * non-personal workspaces the account can read (usually "live" plus other
 * shared workspaces); the technical name is derived from the title on the
 * server.
 */
export function CreateWorkspaceDialog({
  open,
  onOpenChange,
  workspaces,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The current listing - source of the base-workspace options. */
  workspaces: Workspace[]
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [baseWorkspaceName, setBaseWorkspaceName] = useState('live')
  const [visibility, setVisibility] = useState<Visibility>('public')
  const contentRepositoryId = useActiveContentRepositoryId()

  // Every open starts with an empty form.
  useValueChange(open, (isOpen) => {
    if (!isOpen) return
    setTitle('')
    setDescription('')
    setBaseWorkspaceName('live')
    setVisibility('public')
  })

  const baseItems = workspaces
    .filter((workspace) => workspace.classification !== 'personal')
    .map((workspace) => ({
      value: workspace.name,
      label: workspace.title || workspace.name,
    }))
  const visibilityItems = [
    {
      value: 'public',
      label: t('workspacesAdmin.visibilityShared', 'Shared - all editors'),
    },
    {
      value: 'private',
      label: t('workspacesAdmin.visibilityPrivate', 'Private - only you'),
    },
  ]

  const mutation = useMutation({
    mutationFn: () =>
      createWorkspace(contentRepositoryId!, {
        classification: 'shared',
        title: title.trim(),
        ...(description.trim() !== ''
          ? { description: description.trim() }
          : {}),
        baseWorkspaceName,
        visibility,
      }),
    onSuccess: (response) => {
      void invalidateWorkspaceQueries()
      toast.success(
        t('workspacesAdmin.created', 'The workspace "{0}" has been created.', [
          response.title,
        ]),
      )
      onOpenChange(false)
    },
    onError: (error) =>
      toast.error(
        apiErrorDescription(
          error,
          t(
            'workspacesAdmin.createFailedDetail',
            'Creating the workspace failed.',
          ),
        ),
        {
          title: t(
            'workspacesAdmin.createFailed',
            'Could not create workspace',
          ),
        },
      ),
  })

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (title.trim() !== '' && !mutation.isPending) mutation.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>
            {t('workspacesAdmin.newWorkspace', 'New workspace')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'workspacesAdmin.newWorkspaceHint',
              'A workspace collects changes until they are published to its base workspace.',
            )}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <Field
            label={t('workspacesAdmin.title2', 'Title')}
            htmlFor="workspace-create-title"
          >
            <Input
              id="workspace-create-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              autoComplete="off"
              required
            />
          </Field>

          <Field
            label={t('workspacesAdmin.description', 'Description')}
            htmlFor="workspace-create-description"
          >
            <Textarea
              id="workspace-create-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={2}
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field
              label={t('workspacesAdmin.baseWorkspace', 'Base workspace')}
              htmlFor="workspace-create-base"
            >
              <Select
                value={baseWorkspaceName}
                onValueChange={(value) => setBaseWorkspaceName(value as string)}
                items={baseItems}
              >
                <SelectTrigger id="workspace-create-base" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {baseItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field
              label={t('workspacesAdmin.visibility', 'Visibility')}
              htmlFor="workspace-create-visibility"
            >
              <Select
                value={visibility}
                onValueChange={(value) => setVisibility(value as Visibility)}
                items={visibilityItems}
              >
                <SelectTrigger
                  id="workspace-create-visibility"
                  className="w-full"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {visibilityItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

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
              disabled={title.trim() === '' || mutation.isPending}
            >
              {mutation.isPending
                ? t('workspacesAdmin.creating', 'Creating…')
                : t('workspacesAdmin.create', 'Create workspace')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
