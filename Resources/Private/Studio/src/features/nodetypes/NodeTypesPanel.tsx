import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNodeTypesWithProperties } from '@/api/nodeTypes'
import { Button } from '@/components/ui/button'
import { CollapsibleGroup } from '@/components/ui/collapsible-group'
import { SearchInput } from '@/components/ui/search-input'
import { LoadingState } from '@/components/ui/spinner'
import { faClassName } from '@/features/tree/nodeTypeIcon'
import { translate as t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import {
  buildCardModels,
  type CardKind,
  type CardModel,
  type CardRow,
} from './cardModel'
import {
  CARD_WIDTH,
  layoutGraph,
  type GraphLayout,
  type PositionedCard,
} from './graphLayout'

/**
 * The Node Types panel: every node type of the content repository as a
 * UML-style class card (icon, label, properties and references - own and
 * inherited) on a pannable/zoomable canvas, connected along the declared
 * supertype relations. Multi-inheritance (mixins) renders naturally: a card
 * simply has several incoming edges.
 *
 * Card geometry is computed, not measured: the layout and the card markup
 * share the pixel constants below, so edges anchor exactly without a
 * measure-then-layout round trip.
 */

const HEADER_HEIGHT = 54
/** The CollapsibleGroup summary: py-2 + one text-xs line, plus the border-t. */
const SECTION_HEADER_HEIGHT = 33
const ROW_HEIGHT = 18
/** Edges attach at the header's vertical center. */
const EDGE_ANCHOR_Y = HEADER_HEIGHT / 2
const MIN_SCALE = 0.08
const MAX_SCALE = 2

const KIND_ACCENT: Record<CardKind, string> = {
  document: 'bg-blue-500',
  collection: 'bg-amber-500',
  content: 'bg-emerald-500',
  other: 'bg-neutral-500',
}

/** Which of a card's two sections are expanded. */
interface SectionOpenState {
  own: boolean
  inherited: boolean
}

/** Own properties open, the (usually long) inherited list tucked away. */
const DEFAULT_OPEN: SectionOpenState = { own: true, inherited: false }

function cardHeight(model: CardModel, open: SectionOpenState): number {
  const sections =
    (model.ownRows.length > 0
      ? SECTION_HEADER_HEIGHT +
        (open.own ? model.ownRows.length * ROW_HEIGHT : 0)
      : 0) +
    (model.inheritedRows.length > 0
      ? SECTION_HEADER_HEIGHT +
        (open.inherited ? model.inheritedRows.length * ROW_HEIGHT : 0)
      : 0)
  return HEADER_HEIGHT + sections
}

interface ViewTransform {
  x: number
  y: number
  scale: number
}

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

/** What a selection emphasizes: the inheritance chain and the direct subtypes. */
interface Highlight {
  selected: string
  /** The selected type plus all transitive supertypes. */
  ancestors: Set<string>
  /** Direct subtypes. */
  children: Set<string>
}

function edgePath(from: PositionedCard, to: PositionedCard): string {
  const x1 = from.x + CARD_WIDTH
  const y1 = from.y + EDGE_ANCHOR_Y
  const x2 = to.x
  const y2 = to.y + EDGE_ANCHOR_Y
  const bend = Math.max(40, (x2 - x1) / 2)
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`
}

function CardSection({
  title,
  rows,
  inherited,
  open,
  onToggle,
}: {
  title: string
  rows: CardRow[]
  inherited: boolean
  open: boolean
  onToggle: () => void
}) {
  return (
    <div className="border-t border-neutral-800 px-3">
      <CollapsibleGroup
        label={<span className="truncate">{title}</span>}
        open={open}
        onOpenChange={onToggle}
        bodyClassName="py-0"
      >
        {rows.map((row) => (
          <div
            key={(row.isReference ? 'ref:' : 'prop:') + row.name}
            className={cn(
              'flex items-center gap-1 text-[10px]',
              inherited ? 'text-neutral-500' : 'text-neutral-200',
            )}
            style={{ height: ROW_HEIGHT }}
            title={
              row.inheritedFrom
                ? t('nodeTypes.inheritedFrom', 'Inherited from {0}', [
                    row.inheritedFrom,
                  ])
                : undefined
            }
          >
            {row.isReference && (
              <i
                className="fas fa-link fa-fw shrink-0 text-[7px] text-neutral-500"
                aria-hidden
              />
            )}
            <span className="truncate">{row.name}</span>
            <span className="ml-auto shrink-0 pl-2 font-mono text-[9px] text-neutral-500">
              {row.type}
            </span>
          </div>
        ))}
      </CollapsibleGroup>
    </div>
  )
}

/**
 * The transformed graph surface (edges + cards). Memoized so panning/zooming
 * - a pure CSS transform on the wrapper - never re-renders the cards.
 */
const GraphSurface = memo(function GraphSurface({
  layout,
  models,
  highlight,
  matches,
  openSections,
  onToggleSection,
}: {
  layout: GraphLayout
  models: Map<string, CardModel>
  highlight: Highlight | null
  matches: Set<string>
  openSections: Record<string, SectionOpenState>
  onToggleSection: (name: string, section: keyof SectionOpenState) => void
}) {
  const emphasized = (name: string): boolean =>
    highlight === null ||
    highlight.ancestors.has(name) ||
    highlight.children.has(name)
  return (
    <>
      <svg
        className="pointer-events-none absolute top-0 left-0 overflow-visible"
        width={layout.width}
        height={layout.height}
        aria-hidden
      >
        {layout.edges.map((edge) => {
          const from = layout.cards.get(edge.from)
          const to = layout.cards.get(edge.to)
          if (!from || !to) return null
          // Emphasize the selected type's inheritance chain and its direct
          // subtype edges; everything else recedes while a selection exists.
          const active =
            highlight !== null &&
            ((highlight.ancestors.has(edge.to) &&
              highlight.ancestors.has(edge.from)) ||
              edge.from === highlight.selected)
          return (
            <path
              key={`${edge.from}->${edge.to}`}
              d={edgePath(from, to)}
              fill="none"
              stroke={
                active ? 'var(--color-blue-500)' : 'var(--color-neutral-600)'
              }
              strokeWidth={active ? 2 : 1}
              opacity={highlight !== null && !active ? 0.25 : 1}
            />
          )
        })}
      </svg>
      {[...layout.cards.values()].map((card) => {
        const model = models.get(card.name)
        if (!model) return null
        const open = openSections[card.name] ?? DEFAULT_OPEN
        return (
          <div
            key={card.name}
            data-card-name={card.name}
            className={cn(
              'absolute cursor-pointer overflow-hidden rounded-md border border-neutral-700 bg-neutral-900 shadow-md',
              model.abstract && 'border-dashed',
              highlight?.selected === card.name && 'border-blue-500',
              matches.has(card.name) && 'ring-2 ring-blue-500/70',
              !emphasized(card.name) && 'opacity-30',
            )}
            style={{
              left: card.x,
              top: card.y,
              width: CARD_WIDTH,
              height: card.height,
            }}
          >
            <div className={cn('h-[3px]', KIND_ACCENT[model.kind])} />
            <div
              className="flex flex-col justify-center gap-0.5 px-3"
              style={{ height: HEADER_HEIGHT - 3 }}
            >
              <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-white">
                <i
                  className={cn(
                    model.icon ? faClassName(model.icon) : 'fas fa-cube',
                    'fa-fw shrink-0 text-[0.7rem] text-neutral-400',
                  )}
                  aria-hidden
                />
                <span className={cn('truncate', model.abstract && 'italic')}>
                  {model.label}
                </span>
                {model.abstract && (
                  <span className="ml-auto shrink-0 rounded-sm bg-neutral-800 px-1 text-[8px] tracking-wide text-neutral-400 uppercase">
                    {t('nodeTypes.abstract', 'Abstract')}
                  </span>
                )}
              </div>
              <div className="truncate font-mono text-[9px] text-neutral-500">
                {model.name}
              </div>
            </div>
            {model.ownRows.length > 0 && (
              <CardSection
                title={t('nodeTypes.properties', 'Properties')}
                rows={model.ownRows}
                inherited={false}
                open={open.own}
                onToggle={() => onToggleSection(card.name, 'own')}
              />
            )}
            {model.inheritedRows.length > 0 && (
              <CardSection
                title={t('nodeTypes.inherited', 'Inherited')}
                rows={model.inheritedRows}
                inherited
                open={open.inherited}
                onToggle={() => onToggleSection(card.name, 'inherited')}
              />
            )}
          </div>
        )
      })}
    </>
  )
})

function Legend() {
  const entries: Array<{ kind: CardKind; label: string }> = [
    { kind: 'document', label: t('nodeTypes.legend.document', 'Document') },
    { kind: 'content', label: t('nodeTypes.legend.content', 'Content') },
    {
      kind: 'collection',
      label: t('nodeTypes.legend.collection', 'Content Collection'),
    },
    { kind: 'other', label: t('nodeTypes.legend.other', 'Mixin / other') },
  ]
  return (
    <div className="pointer-events-none absolute bottom-2 left-2 z-10 flex flex-col gap-1 rounded-md bg-neutral-900/80 p-2 text-[10px] text-neutral-400 backdrop-blur-xs">
      {entries.map((entry) => (
        <div key={entry.kind} className="flex items-center gap-1.5">
          <span
            className={cn('size-2 rounded-full', KIND_ACCENT[entry.kind])}
          />
          {entry.label}
        </div>
      ))}
      <div className="flex items-center gap-1.5">
        <span className="size-2 rounded-sm border border-dashed border-neutral-500" />
        {t('nodeTypes.legend.abstract', 'Abstract type')}
      </div>
    </div>
  )
}

export function NodeTypesPanel() {
  const viewportRef = useRef<HTMLDivElement>(null)
  // The panel mounts hidden behind the Visual Editor tab; the node types
  // is only fetched (and fitted) once the tab has actually been shown.
  const [visible, setVisible] = useState(false)
  const {
    data: nodeTypes,
    isLoading,
    isError,
  } = useNodeTypesWithProperties(visible)

  const models = useMemo(
    () => (nodeTypes ? buildCardModels(nodeTypes) : []),
    [nodeTypes],
  )
  const modelsByName = useMemo(
    () => new Map(models.map((model) => [model.name, model])),
    [models],
  )
  // Collapsing/expanding a card section changes its height, so the state
  // lives here and feeds the layout - cards below shift and edges re-anchor.
  const [openSections, setOpenSections] = useState<
    Record<string, SectionOpenState>
  >({})
  const toggleSection = useCallback(
    (name: string, section: keyof SectionOpenState) =>
      setOpenSections((current) => {
        const open = current[name] ?? DEFAULT_OPEN
        return { ...current, [name]: { ...open, [section]: !open[section] } }
      }),
    [],
  )

  const layout = useMemo(
    () =>
      layoutGraph(
        models.map((model) => ({
          name: model.name,
          superTypes: model.superTypes,
          height: cardHeight(model, openSections[model.name] ?? DEFAULT_OPEN),
        })),
      ),
    [models, openSections],
  )

  const [view, setView] = useState<ViewTransform>({ x: 40, y: 40, scale: 1 })
  const [selected, setSelected] = useState<string | null>(null)
  const [term, setTerm] = useState('')

  // Visibility via size: the hidden tab's wrapper has zero width.
  useEffect(() => {
    const element = viewportRef.current
    if (!element) return
    const observer = new ResizeObserver(() => {
      if (element.clientWidth > 0) setVisible(true)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const fitToView = () => {
    const element = viewportRef.current
    if (!element || layout.width === 0 || element.clientWidth === 0) return
    const padding = 40
    const scale = clampScale(
      Math.min(
        (element.clientWidth - padding * 2) / layout.width,
        (element.clientHeight - padding * 2) / layout.height,
        1,
      ),
    )
    setView({
      scale,
      x: (element.clientWidth - layout.width * scale) / 2,
      y: (element.clientHeight - layout.height * scale) / 2,
    })
  }

  // Fit once, as soon as both the layout and a real viewport size exist.
  const fitted = useRef(false)
  useEffect(() => {
    if (fitted.current || !visible || layout.width === 0) return
    fitted.current = true
    fitToView()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, layout])

  // Wheel zoom towards the cursor. Attached natively: React's synthetic
  // wheel handlers cannot reliably preventDefault (passive listeners).
  useEffect(() => {
    const element = viewportRef.current
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = element.getBoundingClientRect()
      const cursorX = event.clientX - rect.left
      const cursorY = event.clientY - rect.top
      setView((current) => {
        // Pinch gestures arrive as ctrl+wheel with small deltas - zoom faster.
        const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0015))
        const scale = clampScale(current.scale * factor)
        const ratio = scale / current.scale
        return {
          scale,
          x: cursorX - (cursorX - current.x) * ratio,
          y: cursorY - (cursorY - current.y) * ratio,
        }
      })
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [])

  const zoomBy = (factor: number) => {
    const element = viewportRef.current
    if (!element) return
    const centerX = element.clientWidth / 2
    const centerY = element.clientHeight / 2
    setView((current) => {
      const scale = clampScale(current.scale * factor)
      const ratio = scale / current.scale
      return {
        scale,
        x: centerX - (centerX - current.x) * ratio,
        y: centerY - (centerY - current.y) * ratio,
      }
    })
  }

  const centerOn = (name: string) => {
    const element = viewportRef.current
    const card = layout.cards.get(name)
    if (!element || !card) return
    setView((current) => {
      // Zoom in at least far enough that the centered card is readable.
      const scale = Math.max(current.scale, 0.5)
      return {
        scale,
        x: element.clientWidth / 2 - (card.x + CARD_WIDTH / 2) * scale,
        y: element.clientHeight / 2 - (card.y + card.height / 2) * scale,
      }
    })
  }

  /**
   * One pointer interaction serves pan and click: below a small movement
   * threshold the gesture selects (the card under the initial press, or
   * clears the selection on empty canvas), above it it pans. The card is
   * remembered at press time - pointer capture retargets move/up events to
   * the viewport, so the release target is useless.
   */
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
    moved: boolean
    pressedCard: string | null
  } | null>(null)

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const target = event.target as HTMLElement
    // Summary rows are the section collapsibles' toggles - like buttons,
    // pressing them must neither pan nor change the selection.
    if (target.closest('button, input, a, summary')) return
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: view.x,
      originY: view.y,
      moved: false,
      pressedCard:
        target.closest('[data-card-name]')?.getAttribute('data-card-name') ??
        null,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const deltaX = event.clientX - drag.startX
    const deltaY = event.clientY - drag.startY
    if (Math.abs(deltaX) + Math.abs(deltaY) > 3) drag.moved = true
    if (drag.moved) {
      setView((current) => ({
        ...current,
        x: drag.originX + deltaX,
        y: drag.originY + deltaY,
      }))
    }
  }

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    if (!drag.moved) setSelected(drag.pressedCard)
  }

  const highlight = useMemo((): Highlight | null => {
    if (!selected || !modelsByName.has(selected)) return null
    const ancestors = new Set<string>([selected])
    const queue = [selected]
    while (queue.length > 0) {
      const current = queue.pop()!
      for (const superType of modelsByName.get(current)?.superTypes ?? []) {
        if (!ancestors.has(superType)) {
          ancestors.add(superType)
          queue.push(superType)
        }
      }
    }
    const children = new Set(
      models
        .filter((model) => model.superTypes.includes(selected))
        .map((model) => model.name),
    )
    return { selected, ancestors, children }
  }, [selected, models, modelsByName])

  const matches = useMemo(() => {
    const query = term.trim().toLowerCase()
    if (query === '') return []
    return models
      .filter(
        (model) =>
          model.name.toLowerCase().includes(query) ||
          model.label.toLowerCase().includes(query),
      )
      .map((model) => model.name)
  }, [term, models])
  const matchSet = useMemo(() => new Set(matches), [matches])
  const matchCursor = useRef(0)
  useEffect(() => {
    matchCursor.current = 0
  }, [term])
  const jumpToNextMatch = () => {
    if (matches.length === 0) return
    const name = matches[matchCursor.current % matches.length]
    matchCursor.current += 1
    setSelected(name)
    centerOn(name)
  }

  return (
    <div className="relative h-full min-h-0 overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center gap-2 p-2">
        <SearchInput
          wrapperClassName="pointer-events-auto max-w-64"
          className="bg-neutral-900/80 backdrop-blur-xs"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') jumpToNextMatch()
          }}
          placeholder={t('nodeTypes.searchPlaceholder', 'Search node types…')}
          aria-label={t(
            'nodeTypes.searchAriaLabel',
            'Search node types by name',
          )}
        />
        {term.trim() !== '' && (
          <span className="shrink-0 text-xs text-neutral-400">
            {t('nodeTypes.matches', '{0} matches', [matches.length])}
          </span>
        )}
        <div className="pointer-events-auto ml-auto flex items-center gap-1 rounded-md bg-neutral-900/80 p-1 backdrop-blur-xs">
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => zoomBy(1 / 1.25)}
            title={t('nodeTypes.zoomOut', 'Zoom out')}
          >
            <i className="fas fa-minus" aria-hidden />
          </Button>
          <span className="w-10 text-center text-[10px] text-neutral-400 tabular-nums">
            {Math.round(view.scale * 100)}%
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => zoomBy(1.25)}
            title={t('nodeTypes.zoomIn', 'Zoom in')}
          >
            <i className="fas fa-plus" aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={fitToView}
            title={t('nodeTypes.fit', 'Fit to view')}
          >
            <i className="fas fa-expand" aria-hidden />
          </Button>
        </div>
      </div>
      <Legend />
      <div
        ref={viewportRef}
        className="h-full w-full cursor-grab touch-none overflow-hidden select-none active:cursor-grabbing"
        style={{
          backgroundImage:
            'radial-gradient(circle, rgba(255, 255, 255, 0.07) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          dragRef.current = null
        }}
      >
        {isLoading && (
          <LoadingState label={t('nodeTypes.loading', 'Loading node types…')} />
        )}
        {isError && (
          <div className="flex h-full items-center justify-center text-sm text-neutral-400">
            {t('nodeTypes.loadFailed', 'The node types could not be loaded.')}
          </div>
        )}
        {!isLoading && !isError && layout.cards.size > 0 && (
          <div
            className="absolute top-0 left-0"
            style={{
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
              transformOrigin: '0 0',
            }}
          >
            <GraphSurface
              layout={layout}
              models={modelsByName}
              highlight={highlight}
              matches={matchSet}
              openSections={openSections}
              onToggleSection={toggleSection}
            />
          </div>
        )}
      </div>
    </div>
  )
}
