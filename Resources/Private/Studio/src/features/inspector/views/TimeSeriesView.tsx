import { useLayoutEffect, useRef, useState } from 'react'
import { translate as t } from '@/lib/i18n'
import { DataSourceWidget } from './DataSourceWidget'
import { dataCollection, dataPath } from './dataPath'
import type { InspectorViewComponent } from './registry'

export const TIME_SERIES_VIEW = 'Neos.Neos/Inspector/Views/Data/TimeSeriesView'

/**
 * A single-series line chart over a data source result - the classic UI's
 * TimeSeriesView contract: viewOptions name the `collection` path, the
 * `series` paths (`timeData`, `valueData`) and the `chart` display options
 * (`selectedInterval` for tick formatting, `yAxisFromZero`). Rendered as
 * plain SVG sized to the inspector column; the widget label names the series
 * (single series - no legend), axes and grid stay recessive, and a hover
 * crosshair reads out exact points.
 */
export const TimeSeriesView: InspectorViewComponent = ({ node, options }) => {
  const series =
    options.series !== null && typeof options.series === 'object'
      ? (options.series as Record<string, unknown>)
      : {}
  const chart =
    options.chart !== null && typeof options.chart === 'object'
      ? (options.chart as Record<string, unknown>)
      : {}

  return (
    <DataSourceWidget node={node} options={options}>
      {(data) => {
        const points = dataCollection(data, options.collection)
          .map((row) => ({
            time: new Date(String(dataPath(row, series.timeData))).getTime(),
            value: Number(dataPath(row, series.valueData)),
          }))
          .filter((p) => Number.isFinite(p.time) && Number.isFinite(p.value))
        if (points.length < 2) {
          return (
            <p className="text-xs text-neutral-600 dark:text-neutral-400">
              {t('view.notEnoughData', 'Not enough data for a chart.')}
            </p>
          )
        }
        return (
          <LineChart
            points={points}
            interval={
              typeof chart.selectedInterval === 'string'
                ? chart.selectedInterval
                : ''
            }
            yFromZero={chart.yAxisFromZero === true}
          />
        )
      }}
    </DataSourceWidget>
  )
}

interface Point {
  time: number
  value: number
}

/** Tick label for a timestamp, per the configured interval (classic UI's set). */
function formatTime(time: number, interval: string): string {
  const date = new Date(time)
  const yy = String(date.getFullYear()).slice(-2)
  switch (interval) {
    case 'years':
    case 'Y':
      return `'${yy}`
    case 'quarters':
    case 'Q':
      return `Q${Math.floor(date.getMonth() / 3) + 1} ${yy}`
    case 'months':
    case 'M':
      return `${date.toLocaleDateString(undefined, { month: 'short' })} '${yy}`
    case 'weeks':
    case 'W':
      return `${date.getDate()}/${date.getMonth() + 1}/${yy}`
    case 'days':
    case 'D':
      return date.toLocaleDateString(undefined, { weekday: 'short' })
    case 'seconds':
    case 'S':
      return date.toLocaleTimeString(undefined, {
        minute: '2-digit',
        second: '2-digit',
      })
    default:
      return String(date.getFullYear())
  }
}

/** ~`count` rounded tick values spanning [min, max]. */
function niceTicks(min: number, max: number, count: number): number[] {
  if (min === max) return [min]
  const step = (max - min) / count
  const magnitude = 10 ** Math.floor(Math.log10(step))
  const nice = [1, 2, 5, 10].find((factor) => step / magnitude <= factor) ?? 10
  const niceStep = nice * magnitude
  const ticks: number[] = []
  for (
    let tick = Math.ceil(min / niceStep) * niceStep;
    tick <= max + niceStep / 1000;
    tick += niceStep
  ) {
    ticks.push(Number(tick.toFixed(6)))
  }
  return ticks
}

function LineChart({
  points,
  interval,
  yFromZero,
}: {
  points: Point[]
  interval: string
  yFromZero: boolean
}) {
  // Size the SVG to the inspector column instead of scaling a fixed viewBox,
  // so text renders undistorted at its configured pixel size.
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const element = containerRef.current
    if (!element) return
    const observer = new ResizeObserver(() => setWidth(element.clientWidth))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const [hover, setHover] = useState<number | null>(null)

  const height = 180
  const times = points.map((p) => p.time)
  const values = points.map((p) => p.value)
  const timeMin = Math.min(...times)
  const timeMax = Math.max(...times)
  const valueMin = yFromZero ? 0 : Math.min(...values)
  const valueMax = Math.max(...values)
  const yTicks = niceTicks(valueMin, valueMax, 3)

  const margin = {
    top: 8,
    right: 8,
    bottom: 18,
    // Room for the widest y tick label.
    left: Math.max(...yTicks.map((t) => String(t).length)) * 6.5 + 8,
  }
  const plotWidth = Math.max(0, width - margin.left - margin.right)
  const plotHeight = height - margin.top - margin.bottom

  const x = (time: number): number =>
    margin.left +
    (timeMax === timeMin
      ? plotWidth / 2
      : ((time - timeMin) / (timeMax - timeMin)) * plotWidth)
  const y = (value: number): number =>
    margin.top +
    plotHeight -
    (valueMax === valueMin
      ? plotHeight / 2
      : ((value - valueMin) / (valueMax - valueMin)) * plotHeight)

  // Up to four x ticks evenly across the domain, deduplicated by label.
  const xTicks: { time: number; label: string }[] = []
  for (let i = 0; i < 4; i++) {
    const time = timeMin + ((timeMax - timeMin) * i) / 3
    const label = formatTime(time, interval)
    if (xTicks[xTicks.length - 1]?.label !== label) {
      xTicks.push({ time, label })
    }
  }

  const line = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.time)},${y(p.value)}`)
    .join('')

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const pointerX = event.clientX - bounds.left
    let nearest = 0
    for (let i = 1; i < points.length; i++) {
      if (
        Math.abs(x(points[i].time) - pointerX) <
        Math.abs(x(points[nearest].time) - pointerX)
      ) {
        nearest = i
      }
    }
    setHover(nearest)
  }

  const hovered = hover !== null ? points[hover] : null

  return (
    <div ref={containerRef} className="relative w-full">
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={t('view.timeSeriesChart', 'Time series chart')}
          onPointerMove={onPointerMove}
          onPointerLeave={() => setHover(null)}
        >
          {/* Recessive grid: one thin line per y tick. */}
          {yTicks.map((tick) => (
            <g key={tick}>
              <line
                x1={margin.left}
                x2={width - margin.right}
                y1={y(tick)}
                y2={y(tick)}
                className="stroke-neutral-300/60 dark:stroke-neutral-700/60"
                strokeWidth={1}
              />
              <text
                x={margin.left - 5}
                y={y(tick)}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-neutral-600 dark:fill-neutral-400 text-[10px] tabular-nums"
              >
                {tick}
              </text>
            </g>
          ))}
          {xTicks.map((tick) => (
            <text
              key={tick.time}
              x={x(tick.time)}
              y={height - 4}
              textAnchor="middle"
              className="fill-neutral-600 dark:fill-neutral-400 text-[10px]"
            >
              {tick.label}
            </text>
          ))}
          <path
            d={line}
            fill="none"
            className="stroke-blue-500"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {hovered && (
            <g>
              <line
                x1={x(hovered.time)}
                x2={x(hovered.time)}
                y1={margin.top}
                y2={margin.top + plotHeight}
                className="stroke-neutral-600/50 dark:stroke-neutral-400/50"
                strokeWidth={1}
              />
              {/* Marker with a surface ring so it reads over the line. */}
              <circle
                cx={x(hovered.time)}
                cy={y(hovered.value)}
                r={4}
                className="fill-blue-500 stroke-neutral-100 dark:stroke-neutral-900"
                strokeWidth={2}
              />
            </g>
          )}
        </svg>
      )}
      {hovered && (
        <div
          className="pointer-events-none absolute top-1 z-10 rounded-md border border-neutral-300 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-900 px-2 py-1 text-xs whitespace-nowrap shadow-md"
          style={
            x(hovered.time) > width / 2
              ? { right: width - x(hovered.time) + 8 }
              : { left: x(hovered.time) + 8 }
          }
        >
          <div className="text-neutral-600 dark:text-neutral-400">
            {new Date(hovered.time).toLocaleString()}
          </div>
          <div className="font-medium text-neutral-950 dark:text-white tabular-nums">
            {hovered.value}
          </div>
        </div>
      )}
    </div>
  )
}
