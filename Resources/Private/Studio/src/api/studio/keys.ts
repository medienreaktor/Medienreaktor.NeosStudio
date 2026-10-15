/**
 * Query keys of everything read from the Studio's own endpoints (Neos.Api's
 * are in api/neos/keys.ts). Every Studio query takes its key from here.
 */
export const studioKeys = {
  /** The user's notifications (the bell) - one list, polled. */
  notifications: ['studio', 'notifications'] as const,
  tasks: {
    /** Task workspaces (the Tasks board) - one list, polled. */
    all: ['studio', 'tasks'] as const,
    /** One task's comment thread - under `all` so invalidating tasks covers it. */
    comments: (workspaceName: string) =>
      ['studio', 'tasks', workspaceName, 'comments'] as const,
  },
  /** The user's own shareable preview links (the Share dialog's list). */
  previewLinks: ['studio', 'previewLinks'] as const,
  access: {
    /** Prefix covering the access-role catalogue AND the own effective access. */
    all: ['studio', 'access'] as const,
    /** The access roles (administration). */
    roles: ['studio', 'access', 'roles'] as const,
    /** The caller's own effective access - what the shell narrows its UI by. */
    mine: ['studio', 'access', 'me'] as const,
  },
  workspaces: {
    /** Prefix covering every Studio read model of every workspace. */
    all: ['studio', 'workspaces'] as const,
    workspace: (name: string) => ['studio', 'workspaces', name] as const,
    documentChanges: (name: string) =>
      ['studio', 'workspaces', name, 'document-changes'] as const,
    documentDiff: (name: string, documentId: string) =>
      ['studio', 'workspaces', name, 'document-diff', documentId] as const,
    conflictDetails: (name: string, nodeAggregateIds: string[]) =>
      [
        'studio',
        'workspaces',
        name,
        'conflict-details',
        nodeAggregateIds,
      ] as const,
    pendingEvents: (name: string) =>
      ['studio', 'workspaces', name, 'pending-events'] as const,
    pendingEventsDiff: (name: string, from: number, to: number) =>
      [
        'studio',
        'workspaces',
        name,
        'pending-events-diff',
        { from, to },
      ] as const,
    trash: (name: string) => ['studio', 'workspaces', name, 'trash'] as const,
  },
}
