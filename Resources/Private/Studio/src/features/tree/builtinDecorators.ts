import { isDeleted, isExplicitlyHidden } from '@/api/nodes'
import { translate as t } from '@/lib/i18n'
import { nodeDecoratorRegistry } from './decorators'
import { resolveNodeTypeIconClass } from './nodeTypeIcon'

/**
 * The shell's own node decorators, registered before mount exactly like a
 * third-party plugin would register its own from its entry point.
 *
 * Orders: the type icon runs first (0) so any other decorator can replace it;
 * the state decorators run at 10, still ahead of the plugin default (100).
 */
export function registerBuiltinNodeDecorators(): void {
  // The configured ui.icon of the node's type (with document/collection/cube
  // fallbacks while the node type map loads or for unknown types).
  nodeDecoratorRegistry.register({
    id: 'Medienreaktor.NeosStudio:typeIcon',
    order: 0,
    decorate: (node, { nodeTypes }) => ({
      icon: resolveNodeTypeIconClass(nodeTypes, node.nodeType),
    }),
  })

  // Hidden nodes dim the whole row - including nodes only hidden by
  // inheritance from a hidden ancestor. The red x badge marks only the
  // explicitly hidden node itself (where unhiding would change anything).
  nodeDecoratorRegistry.register({
    id: 'Medienreaktor.NeosStudio:hidden',
    order: 10,
    decorate: (node) => {
      if (!node.tags.all.includes('disabled')) return null
      const explicit = isExplicitlyHidden(node)
      const title = explicit
        ? t('tree.decor.hidden', 'Hidden')
        : t('tree.decor.hiddenInherited', 'Hidden (inherited)')
      return {
        opacity: 0.5,
        title,
        overlay: explicit ? { icon: 'circle-xmark', label: title } : undefined,
      }
    },
  })

  nodeDecoratorRegistry.register({
    id: 'Medienreaktor.NeosStudio:hiddenInMenu',
    order: 10,
    decorate: (node) =>
      node.properties['hiddenInMenu']?.value === true
        ? {
            opacity: 0.5,
            title: t('tree.decor.hiddenInMenu', 'Hidden in menus'),
          }
        : null,
  })

  // Deleted (soft-removed) nodes appear where reads ask for them - outlining
  // a deleted document, review surfaces. Same pattern as hidden: everything
  // in the removed subtree dims, the badge marks the deleted node itself.
  nodeDecoratorRegistry.register({
    id: 'Medienreaktor.NeosStudio:deleted',
    order: 10,
    decorate: (node) => {
      if (!isDeleted(node)) return null
      const explicit = !node.tags.inherited.includes('removed')
      const title = explicit
        ? t('tree.decor.deleted', 'Deleted')
        : t('tree.decor.deletedInherited', 'Deleted (inherited)')
      return {
        opacity: 0.5,
        title,
        overlay: explicit ? { icon: 'trash-can', label: title } : undefined,
      }
    },
  })
}
