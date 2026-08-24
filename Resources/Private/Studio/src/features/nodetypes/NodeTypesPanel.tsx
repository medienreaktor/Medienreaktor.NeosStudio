import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { useNodeTypesWithProperties } from '@/api/nodeTypes'
import {
  GraphCanvas,
  type GraphCanvasHandle,
} from '@/components/graph/GraphCanvas'
import { cardSurface, SELECTED_RING } from '@/components/graph/cardStyle'
import { CollapsibleGroup } from '@/components/ui/collapsible-group'
import { SearchInput } from '@/components/ui/search-input'
import { LoadingState } from '@/components/ui/spinner'
import { faClassName } from '@/features/tree/nodeTypeIcon'
import { translate as t } from '@/lib/i18n'
import { cn, floatingControl } from '@/lib/utils'
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
 * inherited) on the shared pannable/zoomable GraphCanvas, connected along the
 * declared supertype relations. Multi-inheritance (mixins) renders naturally:
 * a card simply has several incoming edges.
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

/** The kind color carries the whole card (outline + surface tint). */
const KIND_COLOR: Record<CardKind, string> = {
  document: 'var(--color-blue-500)',
  collection: 'var(--color-amber-500)',
  content: 'var(--color-emerald-500)',
  other: 'var(--color-neutral-500)',
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
    <div className="border-t border-neutral-950/10 dark:border-white/10 px-3">
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
              'flex items-center gap-1 text-[10px] text-neutral-950 dark:text-white',
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
                className="fas fa-link fa-fw shrink-0 text-[7px] text-neutral-950/50 dark:text-white/50"
                aria-hidden
              />
            )}
            <span className="truncate">{row.name}</span>
            <span className="ml-auto shrink-0 pl-2 font-mono text-[9px] text-neutral-950/50 dark:text-white/50">
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
                active
                  ? 'var(--color-blue-500)'
                  : 'light-dark(var(--color-neutral-400), var(--color-neutral-600))'
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
            data-graph-id={card.name}
            className={cn(
              'absolute cursor-pointer overflow-hidden rounded-md border-2 shadow-md',
              model.abstract && 'border-dashed',
              matches.has(card.name) && 'ring-2 ring-blue-500/60',
              highlight?.selected === card.name && SELECTED_RING,
              !emphasized(card.name) && 'opacity-30',
            )}
            style={{
              left: card.x,
              top: card.y,
              width: CARD_WIDTH,
              height: card.height,
              ...cardSurface(KIND_COLOR[model.kind]),
            }}
          >
            <div
              className="flex flex-col justify-center gap-0.5 px-3"
              style={{ height: HEADER_HEIGHT }}
            >
              <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-neutral-950 dark:text-white">
                <i
                  className={cn(
                    model.icon ? faClassName(model.icon) : 'fas fa-cube',
                    'fa-fw shrink-0 text-[0.7rem] text-neutral-950 dark:text-white',
                  )}
                  aria-hidden
                />
                <span className={cn('truncate', model.abstract && 'italic')}>
                  {model.label}
                </span>
                {model.abstract && (
                  <span className="ml-auto shrink-0 rounded-sm bg-neutral-200 dark:bg-neutral-800 px-1 text-[8px] tracking-wide text-neutral-950/50 dark:text-white/50 uppercase">
                    {t('nodeTypes.abstract', 'Abstract')}
                  </span>
                )}
              </div>
              <div className="truncate font-mono text-[9px] text-neutral-950/50 dark:text-white/50">
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
    <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex flex-col gap-1 rounded-md bg-neutral-50/80 dark:bg-neutral-900/80 p-2 text-[10px] text-neutral-950/50 dark:text-white/50 backdrop-blur-xs">
      {entries.map((entry) => (
        <div key={entry.kind} className="flex items-center gap-1.5">
          <span
            className="size-2 rounded-full"
            style={{ background: KIND_COLOR[entry.kind] }}
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
  const canvasRef = useRef<GraphCanvasHandle>(null)
  // The panel mounts hidden behind the Visual Editor tab; the node types
  // are only fetched once the tab has actually been shown (GraphCanvas
  // reports the visibility edge).
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

  const [selected, setSelected] = useState<string | null>(null)
  const [term, setTerm] = useState('')

  const centerOn = (name: string) => {
    const card = layout.cards.get(name)
    if (!card) return
    canvasRef.current?.centerOnRect(
      { x: card.x, y: card.y, width: CARD_WIDTH, height: card.height },
      0.5,
    )
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
  const jumpToNextMatch = () => {
    if (matches.length === 0) return
    const name = matches[matchCursor.current % matches.length]
    matchCursor.current += 1
    setSelected(name)
    centerOn(name)
  }

  return (
    <GraphCanvas
      ref={canvasRef}
      contentWidth={layout.width}
      contentHeight={layout.height}
      onVisibilityChange={(shown) => shown && setVisible(true)}
      onPick={setSelected}
      overlay={
        <>
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center gap-2 p-3 pr-32">
            <SearchInput
              wrapperClassName="pointer-events-auto max-w-64"
              className={floatingControl}
              value={term}
              onChange={(event) => {
                matchCursor.current = 0
                setTerm(event.target.value)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') jumpToNextMatch()
              }}
              placeholder={t(
                'nodeTypes.searchPlaceholder',
                'Search node types…',
              )}
              aria-label={t(
                'nodeTypes.searchAriaLabel',
                'Search node types by name',
              )}
            />
            {term.trim() !== '' && (
              <span className="shrink-0 text-xs text-neutral-950/50 dark:text-white/50">
                {t('nodeTypes.matches', '{0} matches', [matches.length])}
              </span>
            )}
          </div>
          <Legend />
          {isLoading && (
            <LoadingState
              className="absolute inset-0"
              label={t('nodeTypes.loading', 'Loading node types…')}
            />
          )}
          {isError && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-neutral-950/50 dark:text-white/50">
              {t('nodeTypes.loadFailed', 'The node types could not be loaded.')}
            </div>
          )}
        </>
      }
    >
      {!isLoading && !isError && layout.cards.size > 0 && (
        <GraphSurface
          layout={layout}
          models={modelsByName}
          highlight={highlight}
          matches={matchSet}
          openSections={openSections}
          onToggleSection={toggleSection}
        />
      )}
    </GraphCanvas>
  )
}
