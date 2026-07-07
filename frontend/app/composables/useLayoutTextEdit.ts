/**
 * Shared bound-vs-unbound text-commit logic. Both the property panel's
 * write-through text field and the inline canvas text editor must write
 * identically: bound elements update the collection's preview-row cell
 * (+ push a fresh preview to every wired target) and never touch the
 * template's `{{ props.x }}` token; unbound elements patch the element's
 * literal content directly.
 */
import { COLLECTION_PROP } from '~/lib/collection/types'
import type { CollectionData } from '~/lib/collection/types'
import type { SmartLayoutBindingContext } from '~/lib/collection/layoutBinding'
import type { GridEditorContext } from '~/composables/useGridEditor'
import { setCell } from '~/lib/collection/model'
import { pushVarPreview, wiredTargets } from '~/lib/collection/preview'
import { isBoundToken } from '~/lib/collection/layoutPromote'

export function useLayoutTextEdit(ctx: GridEditorContext, binding: SmartLayoutBindingContext | null) {
  function boundSocket(el: { content?: string }): string | null {
    // Single source of truth for whole-token detection (layoutPromote.ts).
    const socket = isBoundToken(el?.content)
    if (!socket) return null
    return binding?.bindings.value[`props.${socket}`] ? socket : null
  }

  function commitText(el: { id: string; content?: string }, value: string): void {
    const socket = boundSocket(el)
    if (socket && binding) {
      const b = binding.bindings.value[`props.${socket}`]
      const colNode = binding.collectionNode.value
      const c = colNode?.data?.properties?.[COLLECTION_PROP] as CollectionData | undefined
      const row = c?.rows[c.previewRow]
      if (c && b?.columnKey && row) {
        setCell(c, row.id, b.columnKey, value)
        pushVarPreview(colNode, wiredTargets(String(colNode.id), binding.nodesAccessor(), binding.edgesAccessor()), binding.nodesAccessor())
      }
      return
    }
    ctx.patchElement(el.id, { content: value } as any)
  }

  return { boundSocket, commitText }
}
