import type { components } from './openapi'

/**
 * The models of Neos.Api, by the names its OpenAPI document gives them.
 * openapi.ts is generated from that document (`npm run api:schema`) and never
 * edited; the shell uses these types as they are, without mapping them into
 * models of its own.
 */
type Schemas = components['schemas']

// Content repository and nodes
export type ContentRepository = Schemas['ContentRepository']
export type ContentDimension = Schemas['ContentDimension']
export type ContentDimensionValue = Schemas['ContentDimensionValue']
export type Node = Schemas['Node']
export type NodeClassification = Schemas['NodeClassification']
export type NodeCreate = Schemas['NodeCreate']
export type NodeCopy = Schemas['NodeCopy']
export type NodeMove = Schemas['NodeMove']
export type NodeTypeChange = Schemas['NodeTypeChange']
export type NodeVariantCreate = Schemas['NodeVariantCreate']
export type NodePropertiesUpdate = Schemas['NodePropertiesUpdate']
export type NodeReferencesUpdate = Schemas['NodeReferencesUpdate']
export type PaginatedNodeListing = Schemas['PaginatedNodeListing']
export type NodeType = Schemas['NodeType']
export type NodeTypeGroup = Schemas['NodeTypeGroup']
export type NodeTypeListing = Schemas['NodeTypeListing']
export type NodeVariantListing = Schemas['NodeVariantListing']
export type UriPathSegment = Schemas['UriPathSegment']
export type ViewData = Schemas['ViewData']
export type DataSourceData = Schemas['DataSourceData']

// Workspaces
export type Workspace = Schemas['Workspace']
export type WorkspaceClassification = Schemas['WorkspaceClassification']
export type WorkspaceCreate = Schemas['WorkspaceCreate']
export type WorkspaceUpdate = Schemas['WorkspaceUpdate']
export type WorkspaceListing = Schemas['WorkspaceListing']
export type WorkspaceRebase = Schemas['WorkspaceRebase']
export type BaseWorkspaceChange = Schemas['BaseWorkspaceChange']
export type WorkspaceRole = Schemas['WorkspaceRole']
export type WorkspaceRoleAssign = Schemas['WorkspaceRoleAssign']
export type WorkspaceRoleAssignment = Schemas['WorkspaceRoleAssignment']
export type WorkspaceRoleSubject = Schemas['WorkspaceRoleSubject']
export type WorkspaceRoleAssignmentListing =
  Schemas['WorkspaceRoleAssignmentListing']
export type Change = Schemas['Change']
export type ChangeDiff = Schemas['ChangeDiff']
export type ConflictingChange = Schemas['ConflictingChange']
export type WorkspaceConflictProblem = Schemas['WorkspaceConflictProblem']
export type WorkspacePublish = Schemas['WorkspacePublish']
export type WorkspaceDiscard = Schemas['WorkspaceDiscard']
export type PublishingResult = Schemas['PublishingResult']
export type Event = Schemas['Event']
export type EventDiff = Schemas['EventDiff']
export type PaginatedEventListing = Schemas['PaginatedEventListing']
export type PaginatedChangeListing = Schemas['PaginatedChangeListing']
export type DiscardingResult = Schemas['DiscardingResult']

// Sites
export type Site = Schemas['Site']
export type SiteListing = Schemas['SiteListing']
export type SiteCreate = Schemas['SiteCreate']
export type SiteUpdate = Schemas['SiteUpdate']
export type SiteCreationOptions = Schemas['SiteCreationOptions']
export type SiteNodeType = Schemas['SiteNodeType']
export type Domain = Schemas['Domain']
export type DomainCreate = Schemas['DomainCreate']
export type DomainUpdate = Schemas['DomainUpdate']

// Users and the current account
export type CurrentAccount = Schemas['CurrentAccount']
export type Account = Schemas['Account']
export type User = Schemas['User']
export type PaginatedUserListing = Schemas['PaginatedUserListing']
export type UserCreate = Schemas['UserCreate']
export type UserUpdate = Schemas['UserUpdate']
export type UserOptions = Schemas['UserOptions']
export type AccountRole = Schemas['AccountRole']
export type Profile = Schemas['Profile']
export type ProfileUpdate = Schemas['ProfileUpdate']
export type PasswordChange = Schemas['PasswordChange']
export type UserPasswordSet = Schemas['UserPasswordSet']

// Media
export type Asset = Schemas['Asset']
export type AssetType = Schemas['AssetType']
export type AssetUpdate = Schemas['AssetUpdate']
export type PaginatedAssetListing = Schemas['PaginatedAssetListing']
export type AssetSource = Schemas['AssetSource']
export type AssetCollection = Schemas['AssetCollection']
export type AssetCollectionCreate = Schemas['AssetCollectionCreate']
export type AssetCollectionUpdate = Schemas['AssetCollectionUpdate']
export type AssetTag = Schemas['AssetTag']
export type AssetTagCreate = Schemas['AssetTagCreate']
export type AssetTagUpdate = Schemas['AssetTagUpdate']
export type AssetUsage = Schemas['AssetUsage']
export type AssetUsageListing = Schemas['AssetUsageListing']
export type CropRectangle = Schemas['CropRectangle']
export type AssetVariantCreate = Schemas['AssetVariantCreate']
export type AssetTagReference = Schemas['AssetTagReference']
export type AssetCollectionReference = Schemas['AssetCollectionReference']
export type AssetIptc = Schemas['AssetIptc']

// Listings and errors
export type ListingMeta = Schemas['ListingMeta']
export type ListingLinks = Schemas['ListingLinks']
export type ProblemDocument = Schemas['ProblemDocument']

/**
 * Where a node is: the four fields of a Node that identify it in a content
 * repository, workspace and dimension space point (as JSON, the way Neos.Api
 * reads and writes it). Every Node is a NodeAddress, so a node read from the
 * API can be passed wherever one is asked for.
 */
export type NodeAddress = Pick<
  Node,
  | 'contentRepositoryId'
  | 'workspaceName'
  | 'dimensionSpacePoint'
  | 'nodeAggregateId'
>

/**
 * One reference of a node, as Node.references lists them by name
 * (include=references, or include=references.node for `node`: the referenced
 * node as getNode returns it without include, null if not readable).
 */
export type NodeReference = NonNullable<Node['references']>[string][number]

export * from './dimensionSpacePoint'
export * from './nodeAddress'
export * from './nodeTypeConfiguration'
