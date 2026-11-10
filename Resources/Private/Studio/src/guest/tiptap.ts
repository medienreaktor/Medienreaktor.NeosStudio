/**
 * The TipTap building blocks a plugin writes its rich text extensions with,
 * published as `tiptap` on the plugin API.
 *
 * A plugin must never bundle TipTap itself: a second copy of @tiptap/core and
 * ProseMirror has its own Extension/Mark/Node classes, its own PluginKey
 * registry and its own `instanceof` checks, so its extensions would not line
 * up with the editor's schema and plugin machinery - marks would vanish from
 * the schema, plugin keys would collide, selections would not be recognised.
 * Building with the editor's own copies is the only way their identities
 * match.
 *
 * Both bundles import this module, and each publishes its own instance: the
 * shell's for the inspector's RichTextEditor, the guest's in the preview
 * frame, where inline editing runs its own TipTap (see pluginApi.ts). A
 * plugin's extension code therefore builds with the copy of the realm it is
 * running in, whichever that is.
 *
 * The selection is what extensions commonly need: the three extension kinds,
 * attribute merging, the input/paste rule helpers and ProseMirror's Plugin and
 * PluginKey for addProseMirrorPlugins(). Additions are cheap but public -
 * every name here is part of the plugin API.
 */
import {
  Extension,
  InputRule,
  Mark,
  Node,
  PasteRule,
  callOrReturn,
  getMarkAttributes,
  getMarkRange,
  markInputRule,
  markPasteRule,
  mergeAttributes,
  nodeInputRule,
  nodePasteRule,
  textInputRule,
  textPasteRule,
  textblockTypeInputRule,
  wrappingInputRule,
} from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

export const tiptap = {
  Extension,
  Mark,
  Node,
  mergeAttributes,
  callOrReturn,
  getMarkAttributes,
  getMarkRange,
  InputRule,
  PasteRule,
  markInputRule,
  markPasteRule,
  nodeInputRule,
  nodePasteRule,
  textInputRule,
  textPasteRule,
  textblockTypeInputRule,
  wrappingInputRule,
  Plugin,
  PluginKey,
}

/** The TipTap building blocks published on the plugin API. */
export type TiptapBuildingBlocks = typeof tiptap
