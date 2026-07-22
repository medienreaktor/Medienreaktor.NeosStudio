import { useEffect, useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'

import { apiErrorDescription } from '@/api/client'
import { queryKeys } from '@/api/keys'
import {
  updateWorkspace,
  type UpdateWorkspaceInput,
  type Workspace,
} from '@/api/workspaces'
import { queryClient } from '@/app/queryClient'
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
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/components/ui/toast'
import { translate as t } from '@/lib/i18n'

/**
 * Edit a workspace's title and description. Only changed fields are sent;
 * requires the manage permission (the row menu only offers it then).
 */
export function EditWorkspaceDialog({
  workspace,
  onOpenChange,
}: {
  /** The workspace being edited; null renders the dialog closed. */
  workspace: Workspace | null
  onOpenChange: (open: boolean) => void
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')

  useEffect(() => {
    if (workspace !== null) {
      setTitle(workspace.title)
      setDescription(workspace.description)
    }
  }, [workspace])

  const changes: UpdateWorkspaceInput = {}
  if (workspace !== null) {
    if (title !== workspace.title) changes.title = title
    if (description !== workspace.description) changes.description = description
  }
  const isDirty = Object.keys(changes).length > 0
  const canSubmit = isDirty && title.trim() !== ''

  const mutation = useMutation({
    mutationFn: () => updateWorkspace(workspace!.name, changes),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.all })
      toast.success(
        t('workspacesAdmin.saved', 'The workspace "{0}" has been saved.', [
          response.workspace.title,
        ]),
      )
      onOpenChange(false)
    },
    onError: (error) =>
      toast.error(
        apiErrorDescription(
          error,
          t('workspacesAdmin.saveFailedDetail', 'Saving the workspace failed.'),
        ),
        { title: t('workspacesAdmin.saveFailed', 'Could not save workspace') },
      ),
  })

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (canSubmit && !mutation.isPending) mutation.mutate()
  }

  return (
    <Dialog open={workspace !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('workspacesAdmin.editWorkspace', 'Edit workspace')}
            {workspace !== null && (
              <span className="ml-2 font-normal text-neutral-400">
                {workspace.name}
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            {t('workspacesAdmin.editWorkspaceHint', 'Title and description.')}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <Field
            label={t('workspacesAdmin.title2', 'Title')}
            htmlFor="workspace-edit-title"
          >
            <Input
              id="workspace-edit-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              autoComplete="off"
              required
            />
          </Field>

          <Field
            label={t('workspacesAdmin.description', 'Description')}
            htmlFor="workspace-edit-description"
          >
            <Textarea
              id="workspace-edit-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={2}
            />
          </Field>

          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={mutation.isPending}
            >
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button type="submit" disabled={!canSubmit || mutation.isPending}>
              {mutation.isPending
                ? t('workspacesAdmin.saving', 'Saving…')
                : t('workspacesAdmin.save', 'Save workspace')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
