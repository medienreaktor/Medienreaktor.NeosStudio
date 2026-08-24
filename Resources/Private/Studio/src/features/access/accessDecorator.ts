import { nodeDecoratorRegistry } from '@/features/tree/decorators'
import { translate as t } from '@/lib/i18n'
import { documentAccessState } from './useAccess'

/**
 * Marks page-tree rows outside the acting user's access roles: the row dims
 * and its icon gets a lock badge.
 *
 * Registered like any other node decorator (see features/tree/decorators.ts),
 * which is what keeps access control out of the tree components entirely -
 * the document tree, the outliner, search results and the pickers all pick
 * the mark up for free.
 *
 * Only `restricted` is marked. `hidden` rows are removed from the tree
 * outright (see the panel's document filter), and `allowed` is the normal
 * case that must stay visually quiet - most editors are unrestricted, and a
 * decorator that painted every row would be pure noise.
 */
export function registerAccessNodeDecorator(): void {
  nodeDecoratorRegistry.register({
    id: 'Medienreaktor.NeosStudio:accessRestricted',
    order: 10,
    decorate: (node) => {
      if (documentAccessState(node) !== 'restricted') return null
      const title = t(
        'access.decor.restricted',
        'Outside your access role — read only',
      )
      return {
        opacity: 0.55,
        title,
        overlay: {
          icon: 'lock',
          label: title,
          color: 'var(--color-amber-500)',
          position: 'bottom-right',
        },
      }
    },
  })
}
