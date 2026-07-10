import type { ContentDimension, DimensionSpacePoint } from '@/api/dimensions'
import { dimensionSpacePointEquals } from '@/api/dimensions'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

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
  if (allowedPoints.some((point) => dimensionSpacePointEquals(point, verbatim))) return verbatim

  const overlap = (point: DimensionSpacePoint) =>
    Object.keys(current).filter((key) => key !== dimensionId && point[key] === current[key]).length

  const candidates = allowedPoints.filter((point) => point[dimensionId] === value)
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
 */
export function DimensionSwitcher({
  dimensions,
  allowedPoints,
  value,
  onChange,
}: {
  dimensions: ContentDimension[]
  allowedPoints: DimensionSpacePoint[]
  /** The dimension space point currently in effect */
  value: DimensionSpacePoint
  onChange: (point: DimensionSpacePoint) => void
}) {
  return (
    <>
      {dimensions.map((dimension) => {
        // A value may be configured but unreachable (e.g. every combination
        // with it is constrained away) - offer only reachable ones enabled.
        const reachable = new Set(allowedPoints.map((point) => point[dimension.id]))
        const items = dimension.values.map((v) => ({ value: v.value, label: v.label }))

        return (
          <Select
            key={dimension.id}
            value={value[dimension.id] ?? undefined}
            onValueChange={(v) => {
              const next = resolveSwitch(value, dimension.id, v as string, allowedPoints)
              if (next && !dimensionSpacePointEquals(next, value)) onChange(next)
            }}
            // Lets SelectValue render the label for the selected value.
            items={items}
          >
            <SelectTrigger className="w-44" title={dimension.label} size="sm">
              {dimension.icon && (
                <i className={`fas fa-${dimension.icon} fa-fw text-[0.7rem] text-muted-foreground`} aria-hidden />
              )}
              <SelectValue placeholder={dimension.label} />
            </SelectTrigger>
            <SelectContent>
              {dimension.values.map((dimensionValue) => (
                <SelectItem
                  key={dimensionValue.value}
                  value={dimensionValue.value}
                  disabled={!reachable.has(dimensionValue.value)}
                >
                  {/* Specializations are listed right after their generalization;
                      indentation makes the hierarchy visible. */}
                  <span style={{ paddingLeft: `${dimensionValue.specializationDepth * 0.75}rem` }}>
                    {dimensionValue.label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )
      })}
    </>
  )
}
