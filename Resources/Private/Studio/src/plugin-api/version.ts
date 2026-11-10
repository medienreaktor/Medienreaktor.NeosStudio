/**
 * The API version a plugin can read to feature-detect. Bump on a
 * breaking change to any exported type or registry contract; plugins that
 * care can compare against it before registering. 2: the shell runs on
 * Neos.Api - its models (Node, Workspace, NodeType, Site, ...) and NodeAddress
 * objects replace the version 1 DTOs and address strings (see the README's
 * "Plugin API version 2").
 *
 * A module of its own so the preview's guest bundle, which publishes the rich
 * text part of the API in the preview frame, carries the same number without
 * pulling in the shell's React surface.
 */
export const version = 2 as const
