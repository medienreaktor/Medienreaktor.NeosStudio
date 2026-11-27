/**
 * The link types a Link Editor offers for these editor options: the ones
 * without `enabled`, and the ones whose `enabled` agrees.
 */
export function enabledLinkTypes<
  T extends { enabled?: (options: Record<string, unknown>) => boolean },
>(types: readonly T[], options: Record<string, unknown>): T[] {
  return types.filter((type) => type.enabled?.(options) ?? true)
}

/** `assets: false` turns the media tab off. */
export function assetLinksEnabled(options: Record<string, unknown>): boolean {
  return options.assets !== false
}
