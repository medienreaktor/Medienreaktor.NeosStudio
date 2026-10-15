/**
 * Query keys of everything read from the Studio's operations (Neos.Api's
 * are in api/neos/keys.ts). Every Studio query takes its key from here.
 */
export const studioKeys = {
  /** The user's notifications (the bell) - one list, polled. */
  notifications: ['studio', 'notifications'] as const,
  /** By content repository, after the prefix covering all of them. */
  tasks: {
    all: ['studio', 'tasks'] as const,
    /** The tasks (the Tasks board) - one list, polled. */
    list: (contentRepositoryId: string) =>
      ['studio', 'tasks', contentRepositoryId, 'list'] as const,
    /** One task's comment thread - under `all` so invalidating tasks covers it. */
    comments: (contentRepositoryId: string, workspaceName: string) =>
      [
        'studio',
        'tasks',
        contentRepositoryId,
        workspaceName,
        'comments',
      ] as const,
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
  /** By content repository, after the prefix covering all of them. */
  workspaces: {
    /** Prefix covering every Studio read model of every workspace. */
    all: ['studio', 'workspaces'] as const,
    documentChanges: (contentRepositoryId: string, name: string) =>
      [
        'studio',
        'workspaces',
        contentRepositoryId,
        name,
        'document-changes',
      ] as const,
    documentDiff: (
      contentRepositoryId: string,
      name: string,
      documentId: string,
    ) =>
      [
        'studio',
        'workspaces',
        contentRepositoryId,
        name,
        'document-diff',
        documentId,
      ] as const,
    conflictDetails: (
      contentRepositoryId: string,
      name: string,
      nodeAggregateIds: string[],
    ) =>
      [
        'studio',
        'workspaces',
        contentRepositoryId,
        name,
        'conflict-details',
        nodeAggregateIds,
      ] as const,
    pendingEvents: (contentRepositoryId: string, name: string) =>
      [
        'studio',
        'workspaces',
        contentRepositoryId,
        name,
        'pending-events',
      ] as const,
    pendingEventsDiff: (
      contentRepositoryId: string,
      name: string,
      from: number,
      to: number,
    ) =>
      [
        'studio',
        'workspaces',
        contentRepositoryId,
        name,
        'pending-events-diff',
        { from, to },
      ] as const,
    trash: (contentRepositoryId: string, name: string) =>
      ['studio', 'workspaces', contentRepositoryId, name, 'trash'] as const,
  },
}
