import { useState } from 'react'
import { ChevronRightIcon, TagIcon } from 'lucide-react'

import type { MediaTag } from '@/api/media'
import { cn } from '@/lib/utils'

interface TagTreeProps {
  tags: MediaTag[]
  selectedTag: string | null
  onSelect: (identifier: string | null) => void
}

/** The nested tag hierarchy as a collapsible tree. */
export function TagTree({ tags, selectedTag, onSelect }: TagTreeProps) {
  if (tags.length === 0) {
    return <p className="px-2 py-1 text-xs text-neutral-500">No tags yet</p>
  }
  return (
    <ul className="space-y-0.5">
      {tags.map((tag) => (
        <TagNode
          key={tag.identifier}
          tag={tag}
          depth={0}
          selectedTag={selectedTag}
          onSelect={onSelect}
        />
      ))}
    </ul>
  )
}

interface TagNodeProps {
  tag: MediaTag
  depth: number
  selectedTag: string | null
  onSelect: (identifier: string | null) => void
}

function TagNode({ tag, depth, selectedTag, onSelect }: TagNodeProps) {
  const [expanded, setExpanded] = useState(true)
  const hasChildren = tag.children.length > 0
  const isSelected = selectedTag === tag.identifier

  return (
    <li>
      <div
        className={cn(
          'group flex items-center gap-1 rounded px-1.5 py-1 text-sm',
          isSelected
            ? 'bg-blue-500/20 text-white'
            : 'text-neutral-300 hover:bg-neutral-800',
        )}
        style={{ paddingLeft: `${depth * 12 + 6}px` }}
      >
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className={cn(
            'grid size-4 shrink-0 place-items-center text-neutral-500',
            !hasChildren && 'invisible',
          )}
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          <ChevronRightIcon
            className={cn(
              'size-3 transition-transform',
              expanded && 'rotate-90',
            )}
          />
        </button>
        <button
          type="button"
          onClick={() => onSelect(isSelected ? null : tag.identifier)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <TagIcon className="size-3.5 shrink-0 text-neutral-500" />
          <span className="truncate">{tag.label}</span>
          {tag.assetCount > 0 && (
            <span className="ml-auto shrink-0 text-xs text-neutral-500">
              {tag.assetCount}
            </span>
          )}
        </button>
      </div>
      {hasChildren && expanded && (
        <ul className="space-y-0.5">
          {tag.children.map((child) => (
            <TagNode
              key={child.identifier}
              tag={child}
              depth={depth + 1}
              selectedTag={selectedTag}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  )
}
