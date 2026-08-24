import type { ContentDimension, DimensionSpacePoint } from '@/api/dimensions'
import { dimensionSpacePointEquals } from '@/api/dimensions'
import { translate as t } from '@/lib/i18n'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/**
 * Picks the dimension space point to switch to when one coordinate changes:
 * the current point with the coordinate replaced if that combination is
 * allowed, otherwise the allowed point with the new coordinate that agrees
 * with the current point on the most other coordinates (dimension combination
 * constraints can rule out the verbatim combination).
 */
function resolveSwitch(
  current: DimensionSpacePoint,
  dimensionId: string,
  value: string,
  allowedPoints: DimensionSpacePoint[],
): DimensionSpacePoint | null {
  const verbatim = { ...current, [dimensionId]: value }
  if (allowedPoints.some((point) => dimensionSpacePointEquals(point, verbatim)))
    return verbatim

  const overlap = (point: DimensionSpacePoint) =>
    Object.keys(current).filter(
      (key) => key !== dimensionId && point[key] === current[key],
    ).length

  const candidates = allowedPoints.filter(
    (point) => point[dimensionId] === value,
  )
  candidates.sort((a, b) => overlap(b) - overlap(a))
  return candidates[0] ?? null
}

/**
 * Topbar dropdowns (one per content dimension) selecting the dimension space
 * point all node views operate in - the choice is encoded into every node
 * address, so document tree, content outliner, inspector and preview follow
 * it automatically. Values that occur in no allowed dimension space point are
 * disabled; when a combination is not allowed, the other coordinates snap to
 * the closest allowed point.
 *
 * Two different reasons make a value unpickable, and they must not look the
 * same. The content dimension configuration can rule a combination out - that
 * is the model saying "this does not exist", and a plain disabled row says it
 * well enough. An access role ruling it out is somebody deciding "not for
 * you", which deserves to be named: those rows carry a lock and a tooltip, so
 * an editor missing their language asks an administrator instead of filing a
 * bug about a broken dropdown.
 *
 * With documentCoverage set (a document is selected), values whose target
 * point the document does not exist in are muted and marked with a "+";
 * choosing one raises onCreateVariant instead of switching, so the caller
 * can offer to create the missing variant.
 */
export function DimensionSwitcher({
  dimensions,
  allowedPoints,
  permittedPoints = allowedPoints,
  value,
  onChange,
  documentCoverage,
  onCreateVariant,
}: {
  dimensions: ContentDimension[]
  /** Every dimension space point the content dimension configuration allows. */
  allowedPoints: DimensionSpacePoint[]
  /**
   * The subset of those the account's access roles permit. Switching only
   * ever targets one of these; the difference to allowedPoints is exactly
   * what renders locked. Defaults to allowedPoints (no access restrictions).
   */
  permittedPoints?: DimensionSpacePoint[]
  /** The dimension space point currently in effect */
  value: DimensionSpacePoint
  onChange: (point: DimensionSpacePoint) => void
  /** Dimension space points the selected document exists in; omit for no document context */
  documentCoverage?: DimensionSpacePoint[]
  onCreateVariant?: (point: DimensionSpacePoint) => void
}) {
  const documentExistsAt = (point: DimensionSpacePoint) =>
    documentCoverage === undefined ||
    documentCoverage.some((covered) =>
      dimensionSpacePointEquals(covered, point),
    )

  return (
    <>
      {dimensions.map((dimension) => {
        // A value may be configured but unreachable (e.g. every combination
        // with it is constrained away) - offer only reachable ones enabled.
        const reachable = new Set(
          allowedPoints.map((point) => point[dimension.id]),
        )
        const items = dimension.values.map((v) => ({
          value: v.value,
          label: v.label,
        }))

        return (
          <Select
            key={dimension.id}
            value={value[dimension.id] ?? undefined}
            onValueChange={(v) => {
              const next = resolveSwitch(
                value,
                dimension.id,
                v as string,
                permittedPoints,
              )
              if (!next || dimensionSpacePointEquals(next, value)) return
              if (!documentExistsAt(next) && onCreateVariant) {
                onCreateVariant(next)
              } else {
                onChange(next)
              }
            }}
            // Lets SelectValue render the label for the selected value.
            items={items}
          >
            <SelectTrigger title={dimension.label}>
              <div className="flex items-center gap-2">
                {dimension.icon && (
                  <i
                    className={`fa fa-${dimension.icon} fa-fw text-[0.7rem] text-neutral-600 dark:text-neutral-400`}
                    aria-hidden
                  />
                )}
                <SelectValue
                  className="hidden @[80rem]:inline"
                  placeholder={dimension.label}
                />
              </div>
            </SelectTrigger>
            <SelectContent>
              {dimension.values.map((dimensionValue) => {
                const target = resolveSwitch(
                  value,
                  dimension.id,
                  dimensionValue.value,
                  permittedPoints,
                )
                // Reachable in the content model but with no permitted point
                // to land on: an access role, not the model, is what stops it.
                const locked =
                  reachable.has(dimensionValue.value) && target === null
                const missingVariant =
                  target !== null && !documentExistsAt(target)
                return (
                  <SelectItem
                    key={dimensionValue.value}
                    value={dimensionValue.value}
                    disabled={!reachable.has(dimensionValue.value) || locked}
                    title={
                      locked
                        ? t(
                            'dimension.accessLocked',
                            'Outside your access role - an administrator can widen it.',
                          )
                        : missingVariant
                          ? t(
                              'dimension.missingVariant',
                              'The selected document does not exist here yet - create it?',
                            )
                          : undefined
                    }
                  >
                    {/* Specializations are listed right after their generalization;
                        indentation makes the hierarchy visible. */}
                    <span
                      className={`inline-flex items-center gap-1.5${missingVariant ? ' text-neutral-600 dark:text-neutral-400' : ''}`}
                      style={{
                        paddingLeft: `${dimensionValue.specializationDepth * 0.75}rem`,
                      }}
                    >
                      {dimensionValue.label}
                      {locked && (
                        <i className="fas fa-lock text-[0.75rem]" aria-hidden />
                      )}
                      {missingVariant && (
                        <i
                          className="fas fa-plus text-[0.875rem]"
                          aria-hidden
                        />
                      )}
                    </span>
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
        )
      })}
    </>
  )
}
