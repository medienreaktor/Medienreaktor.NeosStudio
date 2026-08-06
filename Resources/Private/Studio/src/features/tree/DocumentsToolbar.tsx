import { DOCUMENT_NODE_TYPE } from '@/api/nodes'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SearchInput } from '@/components/ui/search-input'
import { useCreatableNodeTypes } from '@/features/creation/creatableNodeTypes'
import { translate as t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { NodeTypeIcon } from './nodeTypeIcon'

// Module-level so useCreatableNodeTypes' memo key stays stable across renders.
const DOCUMENT_SUPER_TYPES = [DOCUMENT_NODE_TYPE]

/**
 * The documents panel's fixed toolbar: title search (grows), the node type
 * filter menu and the "new document" button (both fixed-size). Search term
 * and filter are owned by the panel - a non-empty term or filter switches the
 * panel from the tree to the flat, depth-independent server-side result list
 * (see DocumentSearchList).
 */
export function DocumentsToolbar({
  searchTerm,
  onSearchTermChange,
  typeFilter,
  onTypeFilterChange,
  createDisabled,
  onCreate,
}: {
  searchTerm: string
  onSearchTermChange: (term: string) => void
  /** Selected document node type names; empty means "no filter". */
  typeFilter: string[]
  onTypeFilterChange: (typeFilter: string[]) => void
  createDisabled: boolean
  onCreate: () => void
}) {
  const creatable = useCreatableNodeTypes(DOCUMENT_SUPER_TYPES)
  // Flat, alphabetical - a filter menu wants quick scanning, not the creation
  // dialog's group structure.
  const documentTypes = (creatable?.groups ?? [])
    .flatMap((group) => group.nodeTypes)
    .sort((a, b) => a.label.localeCompare(b.label))
  const filterActive = typeFilter.length > 0

  return (
    <div className="sticky top-0 z-10 flex shrink-0 items-center gap-2 bg-neutral-50/50 dark:bg-neutral-950/50 backdrop-blur-xs p-2">
      <SearchInput
        value={searchTerm}
        onChange={(event) => onSearchTermChange(event.target.value)}
        placeholder={t('tree.searchPlaceholder', 'Search documents…')}
        aria-label={t('tree.searchAriaLabel', 'Search documents by title')}
      />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="outline"
              size="icon-sm"
              title={t('tree.filterByNodeType', 'Filter by node type')}
              aria-label={t('tree.filterByNodeType', 'Filter by node type')}
              disabled={creatable === null}
              className={cn(filterActive && 'border-blue-500 text-blue-500')}
            />
          }
        >
          <i className="fas fa-filter" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-80 w-64">
          {/* GroupLabel must live inside a Group (Base UI error 31 otherwise). */}
          <DropdownMenuGroup>
            <DropdownMenuLabel>
              {t('tree.filterByNodeType', 'Filter by node type')}
            </DropdownMenuLabel>
            {documentTypes.map((nodeType) => (
              <DropdownMenuCheckboxItem
                key={nodeType.name}
                checked={typeFilter.includes(nodeType.name)}
                onCheckedChange={(checked) =>
                  onTypeFilterChange(
                    checked
                      ? [...typeFilter, nodeType.name]
                      : typeFilter.filter((name) => name !== nodeType.name),
                  )
                }
              >
                <NodeTypeIcon
                  nodeTypes={creatable?.nodeTypes}
                  nodeTypeName={nodeType.name}
                />
                <span className="truncate">{nodeType.label}</span>
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuGroup>
          {filterActive && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onTypeFilterChange([])}>
                <i className="fas fa-fw fa-xmark" aria-hidden />
                {t('tree.clearFilter', 'Clear filter')}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        size="icon-sm"
        title={t('tree.newDocument', 'New document…')}
        aria-label={t('tree.newDocumentAria', 'New document')}
        disabled={createDisabled}
        onClick={onCreate}
      >
        <i className="fas fa-plus" aria-hidden />
      </Button>
    </div>
  )
}
