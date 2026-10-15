import type { components } from '../../neos/schema/openapi'

/**
 * The models of the Studio's operations of the Neos API, by the names its
 * OpenAPI document gives them - generated with Neos.Api's into
 * api/neos/schema/openapi.ts (`npm run api:schema`). The shell uses these
 * types as they are, without mapping them into models of its own.
 */
type Schemas = components['schemas']

// Tasks
export type Task = Schemas['Task']
export type TaskStatus = Schemas['TaskStatus']
export type TaskComment = Schemas['TaskComment']
export type TaskCreate = Schemas['TaskCreate']
export type TaskUpdate = Schemas['TaskUpdate']
export type TaskListing = Schemas['TaskListing']
export type TaskSubmit = Schemas['TaskSubmit']
export type TaskReopen = Schemas['TaskReopen']
export type TaskAssigneeChange = Schemas['TaskAssigneeChange']
export type TaskCommentCreate = Schemas['TaskCommentCreate']
export type TaskCommentListing = Schemas['TaskCommentListing']

// Notifications
export type StudioNotification = Schemas['Notification']
export type PaginatedNotificationListing =
  Schemas['PaginatedNotificationListing']
export type NotificationsMarkRead = Schemas['NotificationsMarkRead']

// Preview links
export type PreviewLink = Schemas['PreviewLink']
export type NewPreviewLink = Schemas['NewPreviewLink']
export type PreviewLinkCreate = Schemas['PreviewLinkCreate']
export type PreviewLinkListing = Schemas['PreviewLinkListing']

// Access roles and the caller's own access
export type AccessRole = Schemas['AccessRole']
export type AccessRoleConstraints = Schemas['AccessRoleConstraints']
export type AccessRoleCreate = Schemas['AccessRoleCreate']
export type AccessRoleUpdate = Schemas['AccessRoleUpdate']
export type AccessRoleListing = Schemas['AccessRoleListing']
export type NodeTreeRule = AccessRoleConstraints['nodeTreeRules'][number]
export type AccessCapability = Schemas['AccessCapabilityList'][number]
export type EffectiveAccessRole = Schemas['EffectiveAccessRole']
/**
 * Where the caller's access roles let them work. The roles come one by one:
 * every question is answered by OR-ing them, which one merged set of
 * constraints couldn't express. features/access/rules.ts evaluates them.
 */
export type MyAccess = Schemas['MyAccess']
export type EffectiveAccess = MyAccess

// Creating a node through its creation dialog
export type CreationDialogNodeCreate = Schemas['CreationDialogNodeCreate']
